import "server-only";

import type { ConsentPurpose, ConsentSource } from "@/generated/prisma/enums";
import { recordAudit } from "@/server/audit";
import type { DbClient, DbExecutor } from "@/server/db/prisma";

/**
 * Consentimento para mensagens pelo WhatsApp (LGPD art. 7º/8º e política do
 * WhatsApp Business). Cada alteração vira um evento no histórico
 * (`consent_events`) com origem e evidência — a prova do consentimento.
 *
 * - Descadastro (PARAR, SAIR…) vale para o NÚMERO: marca a conversa, revoga o
 *   consentimento de todos os cadastros com o telefone e cancela lembretes e
 *   etapas de acompanhamento pendentes. Responder a quem escreve continua
 *   permitido (o contato iniciou a conversa).
 * - Recadastro (VOLTAR) ou "sim" ao assistente reativa só lembretes e avisos
 *   de atendimento — nunca mensagens promocionais, que exigem consentimento
 *   específico registrado pela equipe.
 */

export interface ConsentEventInput {
  phone: string;
  purpose: ConsentPurpose;
  granted: boolean;
  source: ConsentSource;
  evidence?: string | null;
  patientId?: string | null;
  leadId?: string | null;
  conversationId?: string | null;
  messageId?: string | null;
  actorId?: string | null;
}

export async function recordConsentEvent(db: DbExecutor, input: ConsentEventInput) {
  await db.consentEvent.create({
    data: {
      phone: input.phone,
      purpose: input.purpose,
      granted: input.granted,
      source: input.source,
      evidence: input.evidence?.slice(0, 200) ?? null,
      patientId: input.patientId ?? null,
      leadId: input.leadId ?? null,
      conversationId: input.conversationId ?? null,
      messageId: input.messageId ?? null,
      actorId: input.actorId ?? null,
    },
  });
}

interface ContactChange {
  conversationId: string;
  source: Exclude<ConsentSource, "STAFF">;
  evidence: string;
  messageId?: string | null;
  actorId?: string | null;
  now: Date;
}

/** Descadastro do número (palavra-chave ou pedido identificado pelo assistente). */
export async function applyOptOut(db: DbClient, change: ContactChange) {
  return db.$transaction(async (tx) => {
    const conversation = await tx.whatsAppConversation.findUnique({
      where: { id: change.conversationId },
      select: { id: true, contactPhone: true, leadId: true, patientId: true },
    });
    if (!conversation) return { changed: false };
    const phone = conversation.contactPhone;

    await tx.whatsAppConversation.update({ where: { id: conversation.id }, data: { optedOutAt: change.now } });

    const patients = await tx.patient.findMany({
      where: { phone },
      select: { id: true, whatsappOptIn: true, marketingOptIn: true },
    });
    const lead = await tx.lead.findUnique({ where: { phone }, select: { id: true, whatsappOptIn: true } });

    await tx.patient.updateMany({
      where: { phone, OR: [{ whatsappOptIn: true }, { marketingOptIn: true }] },
      data: { whatsappOptIn: false, whatsappOptInAt: change.now, marketingOptIn: false, marketingOptInAt: change.now },
    });
    if (lead?.whatsappOptIn) {
      await tx.lead.update({ where: { id: lead.id }, data: { whatsappOptIn: false, whatsappOptInAt: null } });
    }

    // Nada proativo sai mais para este número: lembretes e etapas pendentes são cancelados.
    const reason = "Contato pediu para não receber mensagens (descadastro).";
    const subjects = [
      ...patients.map((patient) => ({ patientId: patient.id })),
      ...(lead ? [{ leadId: lead.id }] : []),
    ];
    if (subjects.length > 0) {
      await tx.reminder.updateMany({
        where: { OR: subjects, status: { in: ["PENDING", "PAUSED"] }, channel: "WHATSAPP" },
        data: { status: "CANCELLED", cancelledAt: change.now, lastError: reason },
      });
    }

    const base = {
      phone,
      source: change.source,
      evidence: change.evidence,
      conversationId: conversation.id,
      messageId: change.messageId ?? null,
      actorId: change.actorId ?? null,
      patientId: conversation.patientId,
      leadId: conversation.leadId ?? lead?.id ?? null,
    };
    await recordConsentEvent(tx, { ...base, purpose: "WHATSAPP", granted: false });
    if (patients.some((patient) => patient.marketingOptIn)) {
      await recordConsentEvent(tx, { ...base, purpose: "MARKETING", granted: false });
    }
    await recordAudit(tx, {
      actorId: change.actorId ?? null,
      action: "consent.update",
      entityType: "whatsapp_conversation",
      entityId: conversation.id,
      metadata: { granted: false, source: change.source === "CONTACT_KEYWORD" ? "contact" : "assistant" },
    });
    return { changed: true };
  });
}

/** Reativa lembretes e avisos de atendimento para o contato (não reativa marketing). */
export async function applyOptIn(db: DbClient, change: ContactChange) {
  return db.$transaction(async (tx) => {
    const conversation = await tx.whatsAppConversation.findUnique({
      where: { id: change.conversationId },
      select: { id: true, contactPhone: true, leadId: true, patientId: true },
    });
    if (!conversation) return { changed: false };

    await tx.whatsAppConversation.update({ where: { id: conversation.id }, data: { optedOutAt: null } });
    if (conversation.patientId) {
      await tx.patient.update({
        where: { id: conversation.patientId },
        data: { whatsappOptIn: true, whatsappOptInAt: change.now },
      });
    }
    if (conversation.leadId) {
      await tx.lead.update({ where: { id: conversation.leadId }, data: { whatsappOptIn: true, whatsappOptInAt: change.now } });
    }
    await recordConsentEvent(tx, {
      phone: conversation.contactPhone,
      purpose: "WHATSAPP",
      granted: true,
      source: change.source,
      evidence: change.evidence,
      conversationId: conversation.id,
      messageId: change.messageId ?? null,
      actorId: change.actorId ?? null,
      patientId: conversation.patientId,
      leadId: conversation.leadId,
    });
    await recordAudit(tx, {
      actorId: change.actorId ?? null,
      action: "consent.update",
      entityType: "whatsapp_conversation",
      entityId: conversation.id,
      metadata: { granted: true, source: change.source === "CONTACT_KEYWORD" ? "contact" : "assistant" },
    });
    return { changed: true };
  });
}

/**
 * Alteração feita pela equipe no cadastro (paciente ou lead). Conceder o
 * consentimento de WhatsApp pela equipe (ex.: obtido presencialmente) também
 * desfaz um descadastro anterior do número.
 */
export async function recordStaffConsentChange(
  db: DbExecutor,
  input: { phone: string; purpose: ConsentPurpose; granted: boolean; actorId: string; patientId?: string; leadId?: string },
) {
  await recordConsentEvent(db, {
    phone: input.phone,
    purpose: input.purpose,
    granted: input.granted,
    source: "STAFF",
    evidence: input.granted ? "Consentimento registrado pela equipe no cadastro." : "Consentimento retirado pela equipe no cadastro.",
    actorId: input.actorId,
    patientId: input.patientId ?? null,
    leadId: input.leadId ?? null,
  });
  if (input.purpose === "WHATSAPP" && input.granted) {
    await db.whatsAppConversation.updateMany({
      where: { contactPhone: input.phone, optedOutAt: { not: null } },
      data: { optedOutAt: null },
    });
  }
}
