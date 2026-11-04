import "server-only";

import { Prisma } from "@/generated/prisma/client";
import type { AppointmentStatus } from "@/generated/prisma/enums";
import { QUALIFICATION_FIELD_LABELS, type AssistantConfig } from "@/lib/assistant-config";
import { addDaysToKey, dateKeyOf, formatKeyDate, formatKeyWeekdayLong, timeOf, todayKey, zonedDateTime } from "@/lib/datetime";
import { firstName } from "@/lib/format";
import { computeAvailableSlots, formatSlotLabel } from "@/server/assistant/availability";
import { runTurn, type ContactContext, type PortResult, type TurnPorts } from "@/server/assistant/engine";
import { RulesAssistantModel } from "@/server/assistant/rules-model";
import { readAssistantState, type AppointmentOption, type StoredSlot } from "@/server/assistant/state";
import { detectConsentKeyword, normalizeText, searchTerms } from "@/server/assistant/text";
import { AssistantModelError, type AssistantModel, type HistoryMessage, type Intent, type KnowledgePassage } from "@/server/assistant/types";
import { recordAudit } from "@/server/audit";
import { messageContext, openText } from "@/server/crypto/content-cipher";
import type { Keyring } from "@/server/crypto/field-encryption";
import type { DbClient } from "@/server/db/prisma";
import { DomainError } from "@/server/errors";
import { logger } from "@/server/logger";
import { maskSensitiveText } from "@/server/logging/redact";
import type { WhatsAppProvider } from "@/server/whatsapp/types";

import { changeAppointmentStatus, createAppointment, rescheduleAppointment } from "./appointments";
import { getAssistantActor, ASSISTANT_USER_ID } from "./assistant-actor";
import { getAssistantConfig } from "./assistant-settings";
import { applyOptIn, applyOptOut } from "./consent";
import type { Actor } from "./context";
import { loadPublishedPassages, recordKnowledgeGap, selectPassages } from "./knowledge";
import { addLeadInteraction, createLead } from "./leads";
import { scheduleAppointmentReminder, type ReminderSettings } from "./reminders";
import { openTask } from "./tasks";
import { deliverAutomatedText } from "./whatsapp";

/**
 * Processador do assistente virtual: uma execução por mensagem recebida.
 *
 * - Fila no banco (`assistant_runs`), reservada com SKIP LOCKED; uma reserva
 *   por conversa (`assistant_locked_until`) impede duas respostas simultâneas.
 * - Mensagens em sequência ("oi" / "quanto custa…") são respondidas juntas: a
 *   execução mais antiga é marcada como substituída.
 * - Falha temporária do motor: nova tentativa com espera; falha definitiva ou
 *   esgotada: a conversa vai para a equipe e o contato recebe o aviso.
 * - Só são enviados ao motor a mensagem e o histórico recente, mascarados.
 */

export interface AssistantDependencies {
  provider: WhatsAppProvider | null;
  /** null: AI_PROVIDER=disabled (só descadastro/recadastro são processados). */
  model: AssistantModel | null;
  timeZone: string;
  keyring: Keyring | null;
  reminderSettings: ReminderSettings;
}

export interface AssistantQueueSummary {
  claimed: number;
  completed: number;
  replied: number;
  skipped: number;
  retried: number;
  failed: number;
  /** Reservadas, mas devolvidas à fila por falta de tempo neste ciclo (sem contar tentativa). */
  released: number;
}

const LEASE_MS = 90_000;
const STALE_RUN_MS = 5 * 60_000;
/** Folga para o restante da execução além do motor (banco, envio pelo WhatsApp com tempo limite próprio). */
const LEASE_MARGIN_MS = 60_000;

/**
 * Reserva da conversa e prazo para outro processador considerar uma execução
 * presa, dimensionados pelo pior caso do motor (ex.: IA com tempo limite e
 * novas tentativas): a reserva nunca vence com a execução ainda em andamento.
 */
export function assistantQueueTimings(model: Pick<AssistantModel, "maxLatencyMs"> | null): { leaseMs: number; staleMs: number } {
  const leaseMs = Math.max(LEASE_MS, (model?.maxLatencyMs ?? 0) + LEASE_MARGIN_MS);
  return { leaseMs, staleMs: Math.max(STALE_RUN_MS, leaseMs + LEASE_MARGIN_MS) };
}
const MODEL_BACKOFF_MS = [30_000, 2 * 60_000];
const MAX_RUN_ATTEMPTS = 3;
const HISTORY_LIMIT = 8;
const BLOCKING_STATUSES: AppointmentStatus[] = ["SCHEDULED", "CONFIRMED", "COMPLETED"];

async function claimRuns(db: DbClient, now: Date, limit: number, conversationId?: string): Promise<string[]> {
  const conversationFilter = conversationId ? Prisma.sql`AND "conversation_id" = ${conversationId}::uuid` : Prisma.empty;
  const rows = await db.$queryRaw<Array<{ id: string; created_at: Date }>>`
    UPDATE "assistant_runs" SET "status" = 'PROCESSING', "locked_at" = ${now}, "attempts" = "attempts" + 1
    WHERE "id" IN (
      SELECT "id" FROM "assistant_runs"
      WHERE "status" = 'PENDING'
        AND ("next_attempt_at" IS NULL OR "next_attempt_at" <= ${now})
        ${conversationFilter}
      ORDER BY "created_at" ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING "id", "created_at"`;
  // O RETURNING não segue o ORDER BY da subconsulta (o plano pode agrupar os ids
  // por hash): a ordem de chegada é restabelecida aqui.
  return rows
    .sort((a, b) => a.created_at.getTime() - b.created_at.getTime() || a.id.localeCompare(b.id))
    .map((row) => row.id);
}

export async function processAssistantQueue(
  db: DbClient,
  deps: AssistantDependencies,
  options: { now?: Date; limit?: number; conversationId?: string } = {},
): Promise<AssistantQueueSummary> {
  const now = options.now ?? new Date();
  const startedAt = Date.now();
  const timings = assistantQueueTimings(deps.model);
  const summary: AssistantQueueSummary = { claimed: 0, completed: 0, replied: 0, skipped: 0, retried: 0, failed: 0, released: 0 };

  // Execuções presas (processo interrompido) voltam para a fila.
  await db.assistantRun.updateMany({
    where: { status: "PROCESSING", lockedAt: { lt: new Date(now.getTime() - timings.staleMs) } },
    data: { status: "PENDING", lockedAt: null },
  });

  const ids = await claimRuns(db, now, options.limit ?? 20, options.conversationId);
  summary.claimed = ids.length;
  for (const [index, id] of ids.entries()) {
    // As execuções do lote rodam uma após a outra. A que não teria tempo de
    // terminar antes de outro processador a considerar presa volta para a fila
    // (com as seguintes), em vez de arriscar processamento em dobro.
    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs + timings.leaseMs > timings.staleMs) {
      const remaining = ids.slice(index);
      const released = await db.assistantRun.updateMany({
        where: { id: { in: remaining }, status: "PROCESSING" },
        data: { status: "PENDING", lockedAt: null, attempts: { decrement: 1 } },
      });
      summary.released += released.count;
      break;
    }
    try {
      // A reserva da conversa conta a partir do início desta execução (não do lote).
      await processRun(db, deps, id, now, new Date(now.getTime() + elapsedMs), timings.leaseMs, summary);
    } catch (error) {
      logger.error("assistant.run.unexpected", { err: error });
      await db.assistantRun.update({
        where: { id },
        data: { status: "FAILED", errorCode: "unexpected", errorMessage: "Falha inesperada no processamento.", completedAt: now },
      });
      summary.failed += 1;
    }
  }
  return summary;
}

interface LoadedRun {
  id: string;
  attempts: number;
  conversationId: string;
  inboundMessageId: string;
  inboundAt: Date;
}

async function processRun(
  db: DbClient,
  deps: AssistantDependencies,
  runId: string,
  now: Date,
  leaseFrom: Date,
  leaseMs: number,
  summary: AssistantQueueSummary,
) {
  const record = await db.assistantRun.findUniqueOrThrow({
    where: { id: runId },
    select: {
      id: true,
      attempts: true,
      conversationId: true,
      inboundMessageId: true,
      inboundMessage: { select: { createdAt: true, receivedAt: true } },
    },
  });
  const run: LoadedRun = {
    id: record.id,
    attempts: record.attempts,
    conversationId: record.conversationId,
    inboundMessageId: record.inboundMessageId,
    inboundAt: record.inboundMessage.receivedAt ?? record.inboundMessage.createdAt,
  };

  // Uma resposta por vez em cada conversa.
  const lease = await db.whatsAppConversation.updateMany({
    where: { id: run.conversationId, OR: [{ assistantLockedUntil: null }, { assistantLockedUntil: { lt: leaseFrom } }] },
    data: { assistantLockedUntil: new Date(leaseFrom.getTime() + leaseMs) },
  });
  if (lease.count === 0) {
    await db.assistantRun.update({
      where: { id: run.id },
      data: { status: "PENDING", lockedAt: null, attempts: { decrement: 1 }, nextAttemptAt: new Date(now.getTime() + 15_000) },
    });
    summary.retried += 1;
    return;
  }

  try {
    if (await isSuperseded(db, run, record.inboundMessage.createdAt)) {
      await finishRun(db, run.id, now, run.inboundAt, { status: "SKIPPED", outcome: "SILENT", flags: ["superseded"] });
      summary.skipped += 1;
      return;
    }
    await executeTurn(db, deps, run, now, summary);
  } finally {
    await db.whatsAppConversation.update({ where: { id: run.conversationId }, data: { assistantLockedUntil: null } });
  }
}

/**
 * Mensagens em sequência são respondidas juntas: a execução de uma mensagem mais
 * nova do mesmo contato responde também às anteriores ainda sem resposta (ver
 * `loadConversationText`). Esta execução é substituída quando existe uma mais
 * nova — pendente, em andamento, concluída ou ela mesma substituída — sem nenhuma
 * mensagem enviada pela clínica entre as duas: é exatamente o caso em que a mais
 * nova inclui esta mensagem no texto que responde. Com uma resposta no meio, a
 * mais nova não a cobre, e esta segue normalmente (nunca fica sem resposta).
 * A ordem de processamento não importa: reprocessar a mais antiga depois da mais
 * nova não gera uma segunda resposta.
 */
async function isSuperseded(db: DbClient, run: LoadedRun, inboundCreatedAt: Date): Promise<boolean> {
  const newer = await db.assistantRun.findFirst({
    where: {
      conversationId: run.conversationId,
      id: { not: run.id },
      status: { not: "FAILED" },
      // Mais nova = criada depois; no mesmo milissegundo, o id desempata (mesma ordem de loadConversationText).
      inboundMessage: {
        OR: [
          { createdAt: { gt: inboundCreatedAt } },
          { createdAt: inboundCreatedAt, id: { gt: run.inboundMessageId } },
        ],
      },
    },
    // A primeira mais nova basta: se ela não cobre esta mensagem, nenhuma posterior cobre.
    orderBy: [{ inboundMessage: { createdAt: "asc" } }, { inboundMessageId: "asc" }],
    select: { inboundMessage: { select: { createdAt: true } } },
  });
  if (!newer) return false;
  const repliesBetween = await db.whatsAppMessage.count({
    where: {
      conversationId: run.conversationId,
      direction: "OUTBOUND",
      body: { not: null },
      createdAt: { gt: inboundCreatedAt, lt: newer.inboundMessage.createdAt },
    },
  });
  return repliesBetween === 0;
}

async function finishRun(
  db: DbClient,
  runId: string,
  now: Date,
  inboundAt: Date,
  data: Omit<Prisma.AssistantRunUncheckedUpdateInput, "completedAt" | "latencyMs" | "lockedAt">,
) {
  await db.assistantRun.update({
    where: { id: runId },
    data: { ...data, lockedAt: null, completedAt: now, latencyMs: Math.max(0, now.getTime() - inboundAt.getTime()) },
  });
}

/** Mensagens recentes decifradas, separando o histórico das mensagens ainda sem resposta. */
async function loadConversationText(db: DbClient, conversationId: string, run: LoadedRun, keyring: Keyring | null) {
  const recent = await db.whatsAppMessage.findMany({
    where: { conversationId, body: { not: null } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 20,
    select: { id: true, direction: true, body: true, createdAt: true },
  });
  const chronological = recent.reverse().map((message) => ({
    ...message,
    text: openText(message.body, messageContext(conversationId), keyring) ?? "",
  }));
  const triggerIndex = chronological.findIndex((message) => message.id === run.inboundMessageId);
  const upToTrigger = triggerIndex >= 0 ? chronological.slice(0, triggerIndex + 1) : chronological;
  let start = upToTrigger.length;
  while (start > 0 && upToTrigger[start - 1]!.direction === "INBOUND") start -= 1;
  const unanswered = upToTrigger.slice(start).slice(-5);
  const history: HistoryMessage[] = upToTrigger
    .slice(0, start)
    .slice(-HISTORY_LIMIT)
    .map((message) => ({
      from: message.direction === "INBOUND" ? "contact" : "clinic",
      text: maskSensitiveText(message.text).slice(0, 800),
    }));
  return { text: unanswered.map((message) => message.text).join("\n").trim(), history };
}

async function executeTurn(db: DbClient, deps: AssistantDependencies, run: LoadedRun, now: Date, summary: AssistantQueueSummary) {
  const conversation = await db.whatsAppConversation.findUniqueOrThrow({
    where: { id: run.conversationId },
    select: {
      id: true,
      contactPhone: true,
      mode: true,
      optedOutAt: true,
      assistantState: true,
      patientId: true,
      leadId: true,
      patient: { select: { id: true, fullName: true, preferredName: true, whatsappOptIn: true } },
      lead: { select: { id: true, name: true, whatsappOptIn: true } },
    },
  });
  const config = await getAssistantConfig(db);
  const { text, history } = await loadConversationText(db, run.conversationId, run, deps.keyring);
  if (!text) {
    await finishRun(db, run.id, now, run.inboundAt, { status: "COMPLETED", outcome: "SILENT", flags: ["no_text"] });
    summary.completed += 1;
    return;
  }

  const assistantAvailable = Boolean(deps.model) && config.enabled;
  let mode: "ASSISTANT" | "HUMAN" = conversation.mode === "HUMAN" || !assistantAvailable ? "HUMAN" : "ASSISTANT";
  const flags: string[] = [];
  if (!assistantAvailable) flags.push("assistant_disabled");

  // Limite de respostas automáticas por hora (outro robô, repetição): a equipe assume.
  let rateLimited = false;
  if (mode === "ASSISTANT") {
    const recentReplies = await db.whatsAppMessage.count({
      where: { conversationId: conversation.id, origin: "ASSISTANT", createdAt: { gte: new Date(now.getTime() - 60 * 60_000) } },
    });
    if (recentReplies >= config.limits.maxRepliesPerHour) {
      rateLimited = true;
      mode = "HUMAN";
      flags.push("rate_limited");
    }
  }

  const activePatients = conversation.patientId
    ? await db.patient.count({ where: { phone: conversation.contactPhone, isActive: true } })
    : 0;
  const contact: ContactContext = {
    kind: conversation.patient ? "patient" : conversation.lead ? "lead" : "unknown",
    firstName: conversation.patient
      ? (conversation.patient.preferredName ?? firstName(conversation.patient.fullName))
      : conversation.lead
        ? firstName(conversation.lead.name)
        : null,
    ambiguous: activePatients > 1,
    remindersConsent: Boolean(conversation.patient?.whatsappOptIn ?? conversation.lead?.whatsappOptIn),
    optedOut: Boolean(conversation.optedOutAt),
  };

  const actor = await getAssistantActor(db);
  const keywordDetected = detectConsentKeyword(text) !== null;
  const ports = buildPorts(db, deps, {
    config,
    now,
    actor,
    run,
    conversation: { id: conversation.id, phone: conversation.contactPhone, patientId: conversation.patientId, leadId: conversation.leadId },
    keywordDetected,
    contactName: contact.firstName,
  });

  if (rateLimited) {
    await ports.handoff("Limite de respostas automáticas por hora atingido", { urgent: false });
    await sendReply(db, deps, run, now, fillHandoffMessage(config), "SYSTEM", flags);
    await finishRun(db, run.id, now, run.inboundAt, { status: "COMPLETED", outcome: "HANDOFF", flags, engine: "limits" });
    summary.completed += 1;
    return;
  }

  const today = todayKey(deps.timeZone, now);
  try {
    const result = await runTurn(
      {
        text,
        maskedText: maskSensitiveText(text).slice(0, 2000),
        history,
        mode,
        now,
        today,
        todayLabel: `${formatKeyWeekdayLong(today)}, ${formatKeyDate(today)}`,
        config,
        contact,
        state: readAssistantState(conversation.assistantState, now, config.limits.stateTtlHours),
      },
      ports,
      deps.model ?? new RulesAssistantModel(),
    );

    await db.whatsAppConversation.update({
      where: { id: conversation.id },
      data: { assistantState: result.state as unknown as Prisma.InputJsonValue },
    });
    flags.push(...result.flags);
    let replyMessageId: string | null = null;
    if (result.reply) {
      const origin = mode === "HUMAN" || result.outcome === "OPT_OUT" || result.outcome === "OPT_IN" ? "SYSTEM" : "ASSISTANT";
      replyMessageId = await sendReply(db, deps, run, now, result.reply, origin, flags);
      summary.replied += replyMessageId ? 1 : 0;
    }
    await finishRun(db, run.id, now, run.inboundAt, {
      status: "COMPLETED",
      engine: mode === "HUMAN" ? "keywords" : (deps.model?.name ?? "rules"),
      intent: result.intent,
      confidence: result.confidence,
      outcome: result.outcome,
      sourceEntryIds: result.sourceIds,
      flags,
      replyMessageId,
      errorCode: null,
      errorMessage: null,
    });
    summary.completed += 1;
  } catch (error) {
    const failure =
      error instanceof AssistantModelError
        ? error
        : new AssistantModelError("Falha inesperada no atendimento automático.", "unexpected", false);
    if (!(error instanceof AssistantModelError)) logger.error("assistant.turn.unexpected", { err: error });

    if (failure.retryable && run.attempts < MAX_RUN_ATTEMPTS) {
      await db.assistantRun.update({
        where: { id: run.id },
        data: {
          status: "PENDING",
          lockedAt: null,
          nextAttemptAt: new Date(now.getTime() + MODEL_BACKOFF_MS[Math.min(run.attempts, MODEL_BACKOFF_MS.length) - 1]!),
          errorCode: failure.code,
          errorMessage: failure.message,
        },
      });
      summary.retried += 1;
      return;
    }
    // Sem resposta segura: a equipe assume e o contato é avisado (nunca fica sem retorno).
    await ports.handoff(`Falha do atendimento automático (${failure.code})`, { urgent: false });
    await sendReply(db, deps, run, now, fillHandoffMessage(config), "SYSTEM", flags);
    await finishRun(db, run.id, now, run.inboundAt, {
      status: "FAILED",
      outcome: "ERROR",
      engine: deps.model?.name ?? "rules",
      flags: [...flags, "fallback_handoff"],
      errorCode: failure.code,
      errorMessage: failure.message,
    });
    summary.failed += 1;
  }
}

function fillHandoffMessage(config: AssistantConfig): string {
  return config.messages.handoff
    .replace(/\{horario_equipe\}/g, config.teamHoursText ? `Nossa equipe atende ${config.teamHoursText}.` : "")
    .replace(/\{[a-z_]+\}/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

async function sendReply(
  db: DbClient,
  deps: AssistantDependencies,
  run: LoadedRun,
  now: Date,
  body: string,
  origin: "ASSISTANT" | "SYSTEM",
  flags: string[],
): Promise<string | null> {
  const delivery = await deliverAutomatedText(
    db,
    deps.provider,
    { conversationId: run.conversationId, body, origin, idempotencyKey: `assistant:${run.id}` },
    now,
    deps.keyring,
  );
  if (delivery.status === "FAILED" || delivery.status === "SKIPPED") {
    flags.push(`delivery:${delivery.reason ?? delivery.status.toLowerCase()}`);
    await openTask(db, {
      kind: "AUTOMATION_FAILURE",
      title: "Resposta automática não enviada",
      details:
        delivery.reason === "outside_service_window"
          ? "A janela de 24 horas fechou antes da resposta. Responda com um modelo aprovado, se for o caso."
          : "O envio pelo WhatsApp falhou. Confira a conversa e responda manualmente.",
      conversationId: run.conversationId,
      dedupeKey: `reply-failure:${run.conversationId}`,
    });
  }
  return delivery.messageId;
}

// -----------------------------------------------------------------------------
// Portas: o que o orquestrador pode fazer, com as checagens do sistema
// -----------------------------------------------------------------------------

interface PortContext {
  config: AssistantConfig;
  now: Date;
  actor: Actor;
  run: LoadedRun;
  conversation: { id: string; phone: string; patientId: string | null; leadId: string | null };
  keywordDetected: boolean;
  contactName: string | null;
}

function formatDateLabel(dateKey: string): string {
  return `${formatKeyWeekdayLong(dateKey).toLowerCase()}, ${formatKeyDate(dateKey).slice(0, 5)}`;
}

function buildPorts(db: DbClient, deps: AssistantDependencies, ctx: PortContext): TurnPorts {
  const { config, now, actor } = ctx;
  const clock = { timeZone: deps.timeZone, now, reminders: deps.reminderSettings };
  let passages: KnowledgePassage[] | undefined;
  let procedures: Array<{ id: string; name: string }> | undefined;
  let upcomingCache: AppointmentOption[] | undefined;

  const subject = () =>
    ctx.conversation.patientId
      ? { patientId: ctx.conversation.patientId }
      : ctx.conversation.leadId
        ? { leadId: ctx.conversation.leadId }
        : null;

  async function listUpcoming(): Promise<AppointmentOption[]> {
    if (upcomingCache) return upcomingCache;
    const owner = subject();
    if (!owner) return (upcomingCache = []);
    const appointments = await db.appointment.findMany({
      where: { ...owner, status: { in: ["SCHEDULED", "CONFIRMED"] }, startsAt: { gt: now } },
      orderBy: { startsAt: "asc" },
      take: 5,
      select: { id: true, startsAt: true, endsAt: true, professionalId: true, procedure: { select: { name: true } } },
    });
    upcomingCache = appointments.map((appointment) => {
      const dateKey = dateKeyOf(appointment.startsAt, deps.timeZone);
      const time = timeOf(appointment.startsAt, deps.timeZone);
      return {
        id: appointment.id,
        label: `${formatSlotLabel({ dateKey, time })}${appointment.procedure ? ` (${appointment.procedure.name})` : ""}`,
        dateLabel: formatDateLabel(dateKey),
        time,
        professionalId: appointment.professionalId,
        durationMinutes: Math.round((appointment.endsAt.getTime() - appointment.startsAt.getTime()) / 60_000),
      };
    });
    return upcomingCache;
  }

  /** O assistente só age sobre agendamentos do próprio contato. */
  async function ownsAppointment(appointmentId: string) {
    return (await listUpcoming()).some((item) => item.id === appointmentId);
  }

  function toPortResult(error: unknown): PortResult {
    if (error instanceof DomainError) {
      if (error.code === "schedule_conflict" || error.code === "date_in_past") return { ok: false, reason: "conflict" };
      logger.warn("assistant.action.refused", { code: error.code });
      return { ok: false, reason: "error" };
    }
    logger.error("assistant.action.failed", { err: error });
    return { ok: false, reason: "error" };
  }

  async function grantConsent(evidence: string) {
    await applyOptIn(db, {
      conversationId: ctx.conversation.id,
      source: "ASSISTANT",
      evidence,
      messageId: ctx.run.inboundMessageId,
      actorId: ASSISTANT_USER_ID,
      now,
    });
  }

  return {
    async searchKnowledge(text, intent) {
      passages ??= await loadPublishedPassages(db);
      return selectPassages(text, passages, intent as Intent | undefined);
    },

    async matchProcedure(text) {
      procedures ??= await db.procedure.findMany({ where: { isActive: true }, select: { id: true, name: true } });
      const message = normalizeText(text);
      const terms = new Set(searchTerms(text));
      let best: { id: string; name: string; size: number } | null = null;
      for (const procedure of procedures) {
        const name = normalizeText(procedure.name);
        const nameTerms = searchTerms(procedure.name);
        const matches = message.includes(name) || (nameTerms.length > 0 && nameTerms.every((term) => terms.has(term)));
        if (matches && (!best || name.length > best.size)) best = { id: procedure.id, name: procedure.name, size: name.length };
      }
      return best ? { id: best.id, name: best.name } : null;
    },

    async findSlots({ preference, reschedule }) {
      const booking = config.booking;
      if (!booking.enabled || !booking.procedureId) return null;
      const procedure = await db.procedure.findFirst({
        where: { id: booking.procedureId, isActive: true },
        select: { name: true, durationMinutes: true },
      });
      if (!procedure) return null;
      const professionalIds = reschedule ? [reschedule.professionalId] : booking.professionalIds;
      if (professionalIds.length === 0) return null;
      const durationMinutes = reschedule ? reschedule.durationMinutes : procedure.durationMinutes;
      const until = zonedDateTime(addDaysToKey(todayKey(deps.timeZone, now), booking.maxDaysAhead + 1), "00:00", deps.timeZone);
      const busy = await db.appointment.findMany({
        where: {
          professionalId: { in: professionalIds },
          status: { in: BLOCKING_STATUSES },
          startsAt: { lt: until },
          endsAt: { gt: now },
          ...(reschedule ? { id: { not: reschedule.id } } : {}),
        },
        select: { professionalId: true, startsAt: true, endsAt: true },
      });
      const result = computeAvailableSlots({
        now,
        timeZone: deps.timeZone,
        weeklyHours: booking.weeklyHours,
        professionalIds,
        durationMinutes,
        stepMinutes: booking.slotStepMinutes,
        minNoticeHours: booking.minNoticeHours,
        maxDaysAhead: booking.maxDaysAhead,
        maxOptions: booking.maxOptions,
        busy,
        preference,
      });
      const slots: StoredSlot[] = result.slots.map((slot) => ({
        startsAt: slot.startsAt.toISOString(),
        professionalId: slot.professionalId,
        durationMinutes,
        dateKey: slot.dateKey,
        time: slot.time,
        label: formatSlotLabel(slot),
      }));
      return { slots, matchedPreference: result.matchedPreference, procedureName: procedure.name };
    },

    async ensureLead({ name, interest, procedureId }) {
      if (ctx.conversation.patientId) return false;
      if (ctx.conversation.leadId) {
        const lead = await db.lead.findUnique({
          where: { id: ctx.conversation.leadId },
          select: { id: true, interest: true, procedureId: true },
        });
        if (!lead) return false;
        const data: Prisma.LeadUncheckedUpdateInput = {};
        if (!lead.interest && interest) data.interest = interest.slice(0, 200);
        if (!lead.procedureId && procedureId) data.procedureId = procedureId;
        if (Object.keys(data).length > 0) {
          await db.lead.update({ where: { id: lead.id }, data });
          await recordAudit(db, {
            actorId: actor.id,
            action: "lead.update",
            entityType: "lead",
            entityId: lead.id,
            metadata: { fields: Object.keys(data).join(","), source: "assistant" },
          });
        }
        return true;
      }
      try {
        const lead = await createLead(
          db,
          actor,
          {
            name,
            phone: ctx.conversation.phone,
            email: undefined,
            source: "WHATSAPP",
            sourceDetail: "Assistente virtual (WhatsApp)",
            interest: interest?.slice(0, 200) ?? undefined,
            procedureId: procedureId ?? undefined,
            priority: "MEDIUM",
            ownerId: undefined,
            notes: undefined,
            whatsappOptIn: false,
            nextActionDate: undefined,
            nextActionTime: undefined,
            nextActionNote: undefined,
          },
          { timeZone: deps.timeZone, now },
        );
        ctx.conversation.leadId = lead.id;
      } catch (error) {
        // Corrida (outra mensagem criou o lead) ou telefone já de paciente: só vincula.
        if (error instanceof DomainError && error.meta?.existingLeadId) {
          ctx.conversation.leadId = error.meta.existingLeadId;
        } else if (error instanceof DomainError && error.meta?.existingPatientId) {
          ctx.conversation.patientId = error.meta.existingPatientId;
          await db.whatsAppConversation.update({ where: { id: ctx.conversation.id }, data: { patientId: ctx.conversation.patientId } });
          return false;
        } else {
          throw error;
        }
      }
      await db.whatsAppConversation.update({ where: { id: ctx.conversation.id }, data: { leadId: ctx.conversation.leadId } });
      return true;
    },

    async book(slot) {
      const owner = subject();
      const procedureId = config.booking.procedureId;
      if (!owner || !procedureId) return { ok: false, reason: "error" };
      const startsAt = new Date(slot.startsAt);
      if (startsAt.getTime() < now.getTime() + config.booking.minNoticeHours * 60 * 60_000) {
        return { ok: false, reason: "conflict" };
      }
      try {
        await createAppointment(
          db,
          actor,
          {
            subject: owner.patientId ? "patient" : "lead",
            patientId: owner.patientId,
            leadId: owner.leadId,
            professionalId: slot.professionalId,
            procedureId,
            date: slot.dateKey,
            startTime: slot.time,
            durationMinutes: slot.durationMinutes,
            notes: "Agendado pelo assistente virtual (WhatsApp), com confirmação do contato.",
            returnId: undefined,
            rescheduledFromId: undefined,
          },
          clock,
        );
        upcomingCache = undefined;
        return { ok: true };
      } catch (error) {
        return toPortResult(error);
      }
    },

    listUpcomingAppointments: listUpcoming,

    async reschedule(appointmentId, slot) {
      if (!(await ownsAppointment(appointmentId))) return { ok: false, reason: "error" };
      try {
        await rescheduleAppointment(
          db,
          actor,
          appointmentId,
          {
            date: slot.dateKey,
            startTime: slot.time,
            durationMinutes: slot.durationMinutes,
            reason: "Remarcado pelo contato via WhatsApp (assistente virtual).",
          },
          clock,
        );
        upcomingCache = undefined;
        return { ok: true };
      } catch (error) {
        return toPortResult(error);
      }
    },

    async cancelAppointment(appointmentId) {
      if (!(await ownsAppointment(appointmentId))) return { ok: false, reason: "error" };
      try {
        await changeAppointmentStatus(
          db,
          actor,
          appointmentId,
          { status: "CANCELLED", reason: "Cancelado pelo contato via WhatsApp (assistente virtual)." },
          clock,
        );
        upcomingCache = undefined;
        return { ok: true };
      } catch (error) {
        return toPortResult(error);
      }
    },

    async optOut() {
      await applyOptOut(db, {
        conversationId: ctx.conversation.id,
        source: ctx.keywordDetected ? "CONTACT_KEYWORD" : "ASSISTANT",
        evidence: ctx.keywordDetected
          ? "Palavra-chave de descadastro recebida pelo WhatsApp."
          : "Pedido para não receber mensagens identificado pelo assistente.",
        messageId: ctx.run.inboundMessageId,
        actorId: ASSISTANT_USER_ID,
        now,
      });
    },

    async optIn() {
      await grantConsent(ctx.keywordDetected ? "Palavra-chave VOLTAR recebida pelo WhatsApp." : "Pedido para voltar a receber mensagens.");
    },

    async grantRemindersConsent() {
      await grantConsent("Contato respondeu SIM à pergunta sobre lembretes pelo WhatsApp.");
      // Horários já marcados passam a ter lembrete.
      const owner = subject();
      if (!owner) return;
      const upcoming = await db.appointment.findMany({
        where: { ...owner, status: { in: ["SCHEDULED", "CONFIRMED"] }, startsAt: { gt: now } },
        select: { id: true, patientId: true, leadId: true, procedureId: true, startsAt: true },
      });
      for (const appointment of upcoming) {
        await scheduleAppointmentReminder(db, appointment, deps.reminderSettings, now);
      }
    },

    async handoff(reason, { urgent }) {
      await db.whatsAppConversation.update({
        where: { id: ctx.conversation.id },
        data: { mode: "HUMAN", handoffAt: now, handoffReason: reason.slice(0, 200) },
      });
      const who = ctx.contactName ?? "contato do WhatsApp";
      await openTask(db, {
        kind: "HANDOFF",
        title: `${urgent ? "URGENTE — " : ""}Atender ${who} no WhatsApp`,
        details: reason,
        urgent,
        conversationId: ctx.conversation.id,
        leadId: ctx.conversation.leadId,
        patientId: ctx.conversation.patientId,
        dedupeKey: `handoff:${ctx.conversation.id}`,
      });
      await recordAudit(db, {
        actorId: actor.id,
        action: "assistant.handoff",
        entityType: "whatsapp_conversation",
        entityId: ctx.conversation.id,
        metadata: { urgent, source: "assistant" },
      });
    },

    async registerQualifiedLead({ nextStep, interest, answers }) {
      const leadId = ctx.conversation.leadId;
      if (!leadId) return;
      const answerLines = config.qualification
        .filter((question) => question.field !== "interest" && answers[question.id])
        .map((question) => `${question.field === "custom" ? question.question : QUALIFICATION_FIELD_LABELS[question.field]}: ${answers[question.id]}`);
      const summary = [
        "Atendimento pelo assistente virtual (WhatsApp).",
        interest ? `Interesse: ${interest}.` : null,
        ...answerLines.map((line) => `${line}.`),
        nextStep === "schedule" ? "Próximo passo: agendar pelo assistente." : "Próximo passo: aguarda contato da equipe.",
      ]
        .filter(Boolean)
        .join(" ");
      // Interação de WhatsApp: o lead passa de "Novo" para "Em atendimento".
      await addLeadInteraction(
        db,
        actor,
        leadId,
        {
          type: "WHATSAPP",
          direction: "INBOUND",
          content: maskSensitiveText(summary).slice(0, 2000),
          occurredDate: undefined,
          occurredTime: undefined,
          nextActionDate: undefined,
          nextActionTime: undefined,
          nextActionNote: undefined,
        },
        { timeZone: deps.timeZone, now },
      );
      const lead = await db.lead.findUnique({ where: { id: leadId }, select: { name: true } });
      await openTask(db, {
        kind: "QUALIFIED_LEAD",
        title: `Oportunidade qualificada: ${lead ? firstName(lead.name) : "lead do WhatsApp"}${interest ? ` — ${interest}` : ""}`,
        details: nextStep === "schedule" ? "Quer agendar (o assistente está oferecendo horários)." : "Pediu contato da equipe.",
        leadId,
        conversationId: ctx.conversation.id,
        dedupeKey: `qualified:${leadId}`,
      });
    },

    async recordGap(reason, question) {
      await recordKnowledgeGap(db, deps.keyring, {
        question,
        reason,
        conversationId: ctx.conversation.id,
        messageId: ctx.run.inboundMessageId,
      });
    },
  };
}
