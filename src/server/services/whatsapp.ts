import "server-only";

import { randomUUID } from "node:crypto";

import type { Prisma } from "@/generated/prisma/client";
import type { ConversationMode, MessageOrigin } from "@/generated/prisma/enums";
import { recordAudit } from "@/server/audit";
import { messageContext, openText, sealText } from "@/server/crypto/content-cipher";
import { getContentKeyring } from "@/server/crypto/content-key";
import type { Keyring } from "@/server/crypto/field-encryption";
import type { DbClient, DbExecutor } from "@/server/db/prisma";
import { DomainError, NotFoundError } from "@/server/errors";
import { logger } from "@/server/logger";
import { maskSensitiveText } from "@/server/logging/redact";
import { WhatsAppSendError, type WhatsAppProvider } from "@/server/whatsapp/types";
import {
  extractWebhookEvents,
  nextMessageStatus,
  webhookEventKey,
  type InboundMessageEvent,
  type StatusEvent,
  type WebhookPayload,
} from "@/server/whatsapp/webhook";

import { assertPermission, auditContext, type Actor } from "./context";
import { pauseFollowUpsOnReply } from "./reminders";
import { completeHandoffTasks } from "./tasks";
import { applyTemplateStatusFromMeta } from "./templates";

/** Regra do WhatsApp: mensagens livres só até 24h após a última mensagem do contato. */
export const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

export function isWithinServiceWindow(lastInboundAt: Date | null, now: Date): boolean {
  return Boolean(lastInboundAt) && now.getTime() - lastInboundAt!.getTime() < SERVICE_WINDOW_MS;
}

const E164 = /^\+[1-9]\d{7,14}$/;

/** Espera entre tentativas de reenvio de mensagens automáticas: 30 s, 2 min, 10 min. */
const MESSAGE_BACKOFF_MS = [30_000, 2 * 60_000, 10 * 60_000];
export const MAX_MESSAGE_ATTEMPTS = 3;

/** Vincula a conversa ao paciente e/ou lead com o mesmo telefone. */
async function findContactLinks(db: DbExecutor, phone: string) {
  const [patient, lead] = await Promise.all([
    db.patient.findFirst({ where: { phone, isActive: true }, orderBy: { createdAt: "asc" }, select: { id: true } }),
    db.lead.findUnique({ where: { phone }, select: { id: true, patientId: true } }),
  ]);
  return { patientId: patient?.id ?? lead?.patientId ?? null, leadId: lead?.id ?? null };
}

/**
 * Conversa única por telefone (upsert atômico — seguro com webhooks simultâneos).
 * Conversas novas começam com o assistente, exceto quando abertas pela equipe.
 */
export async function upsertConversation(
  db: DbExecutor,
  phone: string,
  contactName?: string | null,
  options: { mode?: ConversationMode } = {},
) {
  if (!E164.test(phone)) throw new DomainError("Telefone do contato inválido.");
  const links = await findContactLinks(db, phone);
  const conversation = await db.whatsAppConversation.upsert({
    where: { contactPhone: phone },
    create: { contactPhone: phone, contactName: contactName ?? null, mode: options.mode ?? "ASSISTANT", ...links },
    update: {},
  });
  const updates: Prisma.WhatsAppConversationUncheckedUpdateInput = {};
  if (!conversation.patientId && links.patientId) updates.patientId = links.patientId;
  if (!conversation.leadId && links.leadId) updates.leadId = links.leadId;
  if (!conversation.contactName && contactName) updates.contactName = contactName;
  if (Object.keys(updates).length === 0) return conversation;
  return db.whatsAppConversation.update({ where: { id: conversation.id }, data: updates });
}

/** Abre (ou cria) a conversa de um paciente ou lead a partir da ficha. */
export async function openConversationFor(
  db: DbClient,
  actor: Actor,
  subject: { patientId?: string; leadId?: string },
) {
  assertPermission(actor, "whatsapp:read");
  let phone: string | null = null;
  if (subject.patientId) {
    phone = (await db.patient.findUnique({ where: { id: subject.patientId }, select: { phone: true } }))?.phone ?? null;
  } else if (subject.leadId) {
    phone = (await db.lead.findUnique({ where: { id: subject.leadId }, select: { phone: true } }))?.phone ?? null;
  }
  if (!phone) throw new NotFoundError("Contato");
  // Conversa iniciada pela equipe fica com a equipe.
  const conversation = await upsertConversation(db, phone, null, { mode: "HUMAN" });
  return { id: conversation.id };
}

function sendFailure(error: unknown): WhatsAppSendError {
  if (error instanceof WhatsAppSendError) return error;
  logger.error("whatsapp.send.unexpected", { err: error });
  return new WhatsAppSendError("Falha inesperada no envio.", "unexpected", false);
}

/** Mensagem livre enviada pela equipe. A conversa passa para atendimento humano. */
export async function sendTextMessage(
  db: DbClient,
  provider: WhatsAppProvider | null,
  actor: Actor,
  conversationId: string,
  body: string,
  now: Date = new Date(),
  keyring: Keyring | null = getContentKeyring(),
) {
  assertPermission(actor, "whatsapp:send");
  if (!provider) {
    throw new DomainError("A integração com o WhatsApp está desativada. Configure a API oficial para enviar mensagens.", {
      code: "whatsapp_disabled",
    });
  }
  const conversation = await db.whatsAppConversation.findUnique({ where: { id: conversationId } });
  if (!conversation) throw new NotFoundError("Conversa");
  if (!isWithinServiceWindow(conversation.lastInboundAt, now)) {
    throw new DomainError(
      "Fora da janela de 24 horas: o WhatsApp só permite mensagens livres até 24h depois da última mensagem do contato. Fora dela, apenas modelos aprovados (como os lembretes) podem ser enviados.",
      { code: "outside_service_window" },
    );
  }

  const message = await db.whatsAppMessage.create({
    data: {
      conversationId,
      direction: "OUTBOUND",
      origin: "STAFF",
      type: "TEXT",
      body: sealText(body, messageContext(conversationId), keyring),
      provider: provider.name,
      status: "PENDING",
      sentById: actor.id,
    },
  });

  try {
    const result = await provider.sendText({ to: conversation.contactPhone, body });
    await db.$transaction(async (tx) => {
      await tx.whatsAppMessage.update({
        where: { id: message.id },
        data: { status: result.status, providerMessageId: result.providerMessageId, sentAt: now, attempts: 1 },
      });
      await tx.whatsAppConversation.update({
        where: { id: conversationId },
        // A equipe respondeu: o assistente para de responder nesta conversa.
        data: { lastMessageAt: now, mode: "HUMAN" },
      });
      await completeHandoffTasks(tx, conversationId, actor.id, now);
      if (conversation.mode !== "HUMAN") {
        await recordAudit(tx, {
          ...auditContext(actor),
          action: "whatsapp.conversation.mode",
          entityType: "whatsapp_conversation",
          entityId: conversationId,
          metadata: { mode: "HUMAN", reason: "staff_reply" },
        });
      }
    });
    await recordAudit(db, {
      ...auditContext(actor),
      action: "whatsapp.message.send",
      entityType: "whatsapp_conversation",
      entityId: conversationId,
      metadata: { simulated: result.status === "SIMULATED" },
    });
    return { id: message.id, status: result.status };
  } catch (error) {
    const failure = sendFailure(error);
    await db.whatsAppMessage.update({
      where: { id: message.id },
      data: { status: "FAILED", failedAt: now, attempts: 1, errorCode: failure.code, errorMessage: failure.message },
    });
    throw new DomainError(failure.message, { code: failure.code });
  }
}

/** Envio de modelo aprovado (lembretes, acompanhamento). Registra a mensagem com uma prévia para o CRM. */
export async function sendTemplateMessage(
  db: DbClient,
  provider: WhatsAppProvider,
  input: {
    phone: string;
    templateName: string;
    language: string;
    parameters: string[];
    preview: string;
    origin: MessageOrigin;
    idempotencyKey: string;
  },
  now: Date = new Date(),
  keyring: Keyring | null = getContentKeyring(),
) {
  const conversation = await upsertConversation(db, input.phone);
  const message = await db.whatsAppMessage.create({
    data: {
      conversationId: conversation.id,
      direction: "OUTBOUND",
      origin: input.origin,
      type: "TEMPLATE",
      templateName: input.templateName,
      body: sealText(input.preview, messageContext(conversation.id), keyring),
      provider: provider.name,
      status: "PENDING",
      idempotencyKey: input.idempotencyKey,
    },
  });
  try {
    const result = await provider.sendTemplate({
      to: input.phone,
      templateName: input.templateName,
      language: input.language,
      bodyParameters: input.parameters,
    });
    await db.$transaction([
      db.whatsAppMessage.update({
        where: { id: message.id },
        data: { status: result.status, providerMessageId: result.providerMessageId, sentAt: now, attempts: 1 },
      }),
      db.whatsAppConversation.update({ where: { id: conversation.id }, data: { lastMessageAt: now } }),
    ]);
    return { messageId: message.id, status: result.status };
  } catch (error) {
    const failure = sendFailure(error);
    await db.whatsAppMessage.update({
      where: { id: message.id },
      data: { status: "FAILED", failedAt: now, attempts: 1, errorCode: failure.code, errorMessage: failure.message },
    });
    throw Object.assign(failure, { messageId: message.id });
  }
}

/**
 * Mensagem automática de TEXTO (resposta do assistente, confirmação de
 * descadastro). Só dentro da janela de 24h. Idempotente pela chave: a mesma
 * resposta nunca é registrada nem enviada duas vezes. Falha temporária fica
 * pendente para reenvio com espera crescente (`retryAutomatedMessages`).
 */
export async function deliverAutomatedText(
  db: DbClient,
  provider: WhatsAppProvider | null,
  input: { conversationId: string; body: string; origin: "ASSISTANT" | "SYSTEM"; idempotencyKey: string },
  now: Date = new Date(),
  keyring: Keyring | null = getContentKeyring(),
): Promise<{ messageId: string | null; status: "SENT" | "SIMULATED" | "PENDING" | "FAILED" | "SKIPPED"; reason?: string }> {
  const existing = await db.whatsAppMessage.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
    select: { id: true, status: true },
  });
  if (existing) {
    // Reprocessamento: a resposta já foi registrada (e possivelmente enviada).
    return { messageId: existing.id, status: existing.status === "FAILED" ? "FAILED" : existing.status === "SIMULATED" ? "SIMULATED" : existing.status === "PENDING" ? "PENDING" : "SENT" };
  }
  if (!provider) return { messageId: null, status: "SKIPPED", reason: "whatsapp_disabled" };

  const conversation = await db.whatsAppConversation.findUnique({
    where: { id: input.conversationId },
    select: { id: true, contactPhone: true, lastInboundAt: true },
  });
  if (!conversation) return { messageId: null, status: "SKIPPED", reason: "conversation_not_found" };
  if (!isWithinServiceWindow(conversation.lastInboundAt, now)) {
    return { messageId: null, status: "SKIPPED", reason: "outside_service_window" };
  }

  const message = await db.whatsAppMessage.create({
    data: {
      conversationId: conversation.id,
      direction: "OUTBOUND",
      origin: input.origin,
      type: "TEXT",
      body: sealText(input.body, messageContext(conversation.id), keyring),
      provider: provider.name,
      status: "PENDING",
      idempotencyKey: input.idempotencyKey,
    },
  });
  const outcome = await attemptTextSend(db, provider, message.id, conversation.contactPhone, input.body, 1, now);
  return { messageId: message.id, status: outcome };
}

async function attemptTextSend(
  db: DbClient,
  provider: WhatsAppProvider,
  messageId: string,
  phone: string,
  body: string,
  attempt: number,
  now: Date,
): Promise<"SENT" | "SIMULATED" | "PENDING" | "FAILED"> {
  try {
    const result = await provider.sendText({ to: phone, body });
    const message = await db.whatsAppMessage.update({
      where: { id: messageId },
      data: {
        status: result.status,
        providerMessageId: result.providerMessageId,
        sentAt: now,
        attempts: attempt,
        nextAttemptAt: null,
        errorCode: null,
        errorMessage: null,
      },
      select: { conversationId: true },
    });
    await db.whatsAppConversation.update({ where: { id: message.conversationId }, data: { lastMessageAt: now } });
    return result.status;
  } catch (error) {
    const failure = sendFailure(error);
    const exhausted = !failure.retryable || attempt >= MAX_MESSAGE_ATTEMPTS;
    await db.whatsAppMessage.update({
      where: { id: messageId },
      data: {
        status: exhausted ? "FAILED" : "PENDING",
        attempts: attempt,
        nextAttemptAt: exhausted ? null : new Date(now.getTime() + MESSAGE_BACKOFF_MS[attempt - 1]!),
        ...(exhausted ? { failedAt: now } : {}),
        errorCode: failure.code,
        errorMessage: failure.message,
      },
    });
    return exhausted ? "FAILED" : "PENDING";
  }
}

/** Reenvia mensagens automáticas com falha temporária (janela de 24h conferida de novo). */
export async function retryAutomatedMessages(
  db: DbClient,
  provider: WhatsAppProvider | null,
  now: Date = new Date(),
  keyring: Keyring | null = getContentKeyring(),
  limit = 25,
) {
  const summary = { retried: 0, sent: 0, failed: 0 };
  if (!provider) return summary;
  const due = await db.whatsAppMessage.findMany({
    where: {
      direction: "OUTBOUND",
      origin: { in: ["ASSISTANT", "SYSTEM"] },
      status: "PENDING",
      attempts: { gte: 1, lt: MAX_MESSAGE_ATTEMPTS },
      nextAttemptAt: { lte: now },
    },
    orderBy: { nextAttemptAt: "asc" },
    take: limit,
    select: { id: true, body: true, attempts: true, conversationId: true, conversation: { select: { contactPhone: true, lastInboundAt: true } } },
  });
  for (const message of due) {
    // Reserva condicional: outro processador simultâneo não reenvia a mesma mensagem.
    const claimed = await db.whatsAppMessage.updateMany({
      where: { id: message.id, status: "PENDING", attempts: message.attempts },
      data: { nextAttemptAt: new Date(now.getTime() + 5 * 60_000) },
    });
    if (claimed.count === 0) continue;
    summary.retried += 1;
    if (!isWithinServiceWindow(message.conversation.lastInboundAt, now)) {
      await db.whatsAppMessage.update({
        where: { id: message.id },
        data: { status: "FAILED", failedAt: now, errorCode: "outside_24h_window", errorMessage: "A janela de 24 horas fechou antes do reenvio." },
      });
      summary.failed += 1;
      continue;
    }
    const body = openText(message.body, messageContext(message.conversationId), keyring) ?? "";
    const outcome = await attemptTextSend(db, provider, message.id, message.conversation.contactPhone, body, message.attempts + 1, now);
    if (outcome === "FAILED") summary.failed += 1;
    else if (outcome !== "PENDING") summary.sent += 1;
  }
  return summary;
}

/** Registra mensagem recebida (webhook ou simulação). Idempotente pelo id do provedor. */
export async function recordInboundMessage(
  db: DbClient,
  event: InboundMessageEvent,
  provider: string,
  keyring: Keyring | null = getContentKeyring(),
) {
  const phone = `+${event.from}`;
  const conversation = await upsertConversation(db, phone, event.contactName);
  const text = event.body ?? (event.type === "text" ? "" : `[${event.type}] conteúdo não exibido`);
  const created = await db.whatsAppMessage.createMany({
    data: [
      {
        conversationId: conversation.id,
        direction: "INBOUND",
        origin: "CONTACT",
        type: event.type === "text" ? "TEXT" : "OTHER",
        body: sealText(text, messageContext(conversation.id), keyring),
        provider,
        providerMessageId: event.providerMessageId,
        status: "RECEIVED",
        receivedAt: event.receivedAt,
      },
    ],
    skipDuplicates: true,
  });
  if (created.count === 0) return { duplicate: true as const, conversationId: conversation.id };

  const message = await db.whatsAppMessage.findUniqueOrThrow({
    where: { providerMessageId: event.providerMessageId },
    select: { id: true },
  });
  const lastInbound =
    conversation.lastInboundAt && conversation.lastInboundAt > event.receivedAt ? conversation.lastInboundAt : event.receivedAt;
  await db.whatsAppConversation.update({
    where: { id: conversation.id },
    data: {
      lastInboundAt: lastInbound,
      lastMessageAt: lastInbound,
      unreadCount: { increment: 1 },
    },
  });

  // O paciente respondeu: a sequência automática de acompanhamento pausa
  // e a conversa segue com o assistente ou a equipe, conforme a intenção.
  if (conversation.patientId) await pauseFollowUpsOnReply(db, conversation.patientId, event.receivedAt);

  // Toda mensagem de texto gera uma execução do assistente (uma só: chave única),
  // inclusive com a equipe atendendo — descadastro (PARAR) vale sempre.
  if (event.type === "text") {
    await db.assistantRun.createMany({
      data: [{ conversationId: conversation.id, inboundMessageId: message.id }],
      skipDuplicates: true,
    });
  }
  return { duplicate: false as const, conversationId: conversation.id, messageId: message.id };
}

const STATUS_TIMESTAMP_FIELD = {
  SENT: "sentAt",
  DELIVERED: "deliveredAt",
  READ: "readAt",
  FAILED: "failedAt",
} as const;

export async function applyStatusEvent(db: DbClient, event: StatusEvent) {
  const message = await db.whatsAppMessage.findUnique({
    where: { providerMessageId: event.providerMessageId },
    select: { id: true, status: true },
  });
  if (!message) return { applied: false, reason: "unknown_message" as const };
  const next = nextMessageStatus(message.status, event.status);
  if (!next) return { applied: false, reason: "stale" as const };
  await db.whatsAppMessage.update({
    where: { id: message.id },
    data: {
      status: next,
      [STATUS_TIMESTAMP_FIELD[next]]: event.occurredAt,
      ...(next === "FAILED"
        ? {
            errorCode: event.errorCode?.slice(0, 40) ?? null,
            errorMessage: event.errorTitle ? maskSensitiveText(event.errorTitle).slice(0, 300) : null,
          }
        : {}),
    },
  });
  return { applied: true as const };
}

/**
 * Processa um payload de webhook já autenticado (assinatura válida).
 * Cada evento é registrado com uma chave única: reentregas da Meta são ignoradas.
 */
export async function processWebhookPayload(db: DbClient, payload: WebhookPayload) {
  const summary = { received: 0, processed: 0, duplicates: 0, failed: 0 };
  for (const event of extractWebhookEvents(payload)) {
    summary.received += 1;
    const eventKey = webhookEventKey(event);
    const registered = await db.webhookEvent.createMany({
      data: [{ provider: "cloud_api", eventKey, kind: event.kind, signatureValid: true }],
      skipDuplicates: true,
    });
    if (registered.count === 0) {
      // Reentrega: ignora se já foi processado; se falhou antes, tenta de novo
      // (o processamento é idempotente pelo id da mensagem no provedor).
      const previous = await db.webhookEvent.findUnique({ where: { eventKey }, select: { processedAt: true } });
      if (previous?.processedAt) {
        summary.duplicates += 1;
        continue;
      }
    }
    try {
      if (event.kind === "message") await recordInboundMessage(db, event, "cloud_api");
      else if (event.kind === "status") await applyStatusEvent(db, event);
      else await applyTemplateStatusFromMeta(db, event);
      await db.webhookEvent.update({ where: { eventKey }, data: { processedAt: new Date(), errorMessage: null } });
      summary.processed += 1;
    } catch (error) {
      summary.failed += 1;
      logger.error("whatsapp.webhook.event_failed", { err: error, kind: event.kind });
      await db.webhookEvent.update({
        where: { eventKey },
        data: { errorMessage: maskSensitiveText(error instanceof Error ? error.message : String(error)).slice(0, 300) },
      });
    }
  }
  return summary;
}

/** Simula uma mensagem recebida (apenas no modo de desenvolvimento), para testar o atendimento. */
export async function simulateInboundMessage(
  db: DbClient,
  provider: WhatsAppProvider | null,
  actor: Actor,
  conversationId: string,
  body: string,
  now: Date = new Date(),
) {
  assertPermission(actor, "whatsapp:send");
  if (provider?.name !== "development") {
    throw new DomainError("A simulação de mensagens só existe no modo de desenvolvimento.");
  }
  const conversation = await db.whatsAppConversation.findUnique({ where: { id: conversationId } });
  if (!conversation) throw new NotFoundError("Conversa");
  const result = await recordInboundMessage(
    db,
    {
      kind: "message",
      providerMessageId: `dev-in-${randomUUID()}`,
      from: conversation.contactPhone.slice(1),
      contactName: conversation.contactName,
      receivedAt: now,
      type: "text",
      body,
    },
    "development",
  );
  await recordAudit(db, {
    ...auditContext(actor),
    action: "whatsapp.inbound.simulate",
    entityType: "whatsapp_conversation",
    entityId: conversationId,
  });
  return result;
}

export async function markConversationRead(db: DbClient, actor: Actor, conversationId: string) {
  assertPermission(actor, "whatsapp:read");
  await db.whatsAppConversation.updateMany({ where: { id: conversationId, unreadCount: { gt: 0 } }, data: { unreadCount: 0 } });
}

/** Alterna quem atende a conversa: o assistente virtual ou a equipe. */
export async function setConversationMode(
  db: DbClient,
  actor: Actor,
  conversationId: string,
  mode: ConversationMode,
  now: Date = new Date(),
) {
  assertPermission(actor, "whatsapp:send");
  return db.$transaction(async (tx) => {
    const conversation = await tx.whatsAppConversation.findUnique({ where: { id: conversationId }, select: { id: true, mode: true } });
    if (!conversation) throw new NotFoundError("Conversa");
    if (conversation.mode === mode) return;
    await tx.whatsAppConversation.update({
      where: { id: conversationId },
      data:
        mode === "HUMAN"
          ? { mode, handoffAt: now, handoffReason: `Assumida pela equipe (${actor.name})` }
          : { mode, handoffReason: null, assistantState: { v: 1 } },
    });
    if (mode === "ASSISTANT") await completeHandoffTasks(tx, conversationId, actor.id, now);
    await recordAudit(tx, {
      ...auditContext(actor),
      action: "whatsapp.conversation.mode",
      entityType: "whatsapp_conversation",
      entityId: conversationId,
      metadata: { mode, reason: "manual" },
    });
  });
}

/**
 * Pedido de eliminação do titular (LGPD art. 18, VI): apaga o TEXTO de todas
 * as mensagens e o estado do assistente, mantendo apenas metadados técnicos e o
 * histórico de consentimento/descadastro (necessário para continuar
 * respeitando o pedido de não receber mensagens — art. 16, I).
 */
export async function eraseConversationContent(db: DbClient, actor: Actor, conversationId: string) {
  assertPermission(actor, "whatsapp:erase");
  return db.$transaction(async (tx) => {
    const conversation = await tx.whatsAppConversation.findUnique({ where: { id: conversationId }, select: { id: true } });
    if (!conversation) throw new NotFoundError("Conversa");
    const messages = await tx.whatsAppMessage.updateMany({
      where: { conversationId },
      data: { body: null },
    });
    await tx.knowledgeGap.deleteMany({ where: { conversationId } });
    await tx.whatsAppConversation.update({
      where: { id: conversationId },
      data: { contactName: null, assistantState: { v: 1 }, unreadCount: 0 },
    });
    await recordAudit(tx, {
      ...auditContext(actor),
      action: "whatsapp.conversation.erase",
      entityType: "whatsapp_conversation",
      entityId: conversationId,
      metadata: { messages: messages.count },
    });
    return { messages: messages.count };
  });
}
