import "server-only";

import type { AssistantConfig } from "@/lib/assistant-config";
import { firstName } from "@/lib/format";
import type { DbClient } from "@/server/db/prisma";

import { countProactive, nextAllowedSendTime } from "./reminders";
import { openTask } from "./tasks";

/**
 * Recuperação de oportunidades (ciclo de automação).
 *
 * 1. Acompanhamento pela IA, DENTRO da janela de 24h: o contato iniciou a
 *    conversa, a assistente respondeu e ele parou de responder. Depois de N
 *    horas de silêncio, a IA pode mandar UMA mensagem curta retomando o
 *    assunto (ou decidir não mandar). No máximo um acompanhamento por
 *    mensagem do contato (chave única), só no horário permitido, dentro dos
 *    limites de frequência, nunca para quem se descadastrou, está com a equipe
 *    ou já tem horário marcado. Desligado por padrão.
 * 2. Fora da janela, mensagem livre é proibida pela Meta: leads parados há N
 *    dias viram TAREFA para a equipe decidir (modelo aprovado ou ligação).
 *    Nada é enviado automaticamente nesse caso.
 */

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
/** O acompanhamento precisa caber com folga na janela de 24h. */
const MIN_WINDOW_LEFT_MS = HOUR;

export type FollowUpEligibility = { ok: true; hoursSilent: number } | { ok: false; reason: string };

export async function checkFollowUpEligibility(
  db: DbClient,
  input: { conversationId: string; now: Date; timeZone: string; config: AssistantConfig; agentAvailable: boolean },
): Promise<FollowUpEligibility> {
  const { config, now } = input;
  if (!input.agentAvailable) return { ok: false, reason: "agent_unavailable" };
  if (!config.enabled || !config.agent.followUp.enabled) return { ok: false, reason: "disabled" };

  const conversation = await db.whatsAppConversation.findUnique({
    where: { id: input.conversationId },
    select: {
      mode: true,
      optedOutAt: true,
      lastInboundAt: true,
      contactPhone: true,
      patientId: true,
      leadId: true,
      lead: { select: { status: true } },
    },
  });
  if (!conversation) return { ok: false, reason: "not_found" };
  if (conversation.mode !== "ASSISTANT") return { ok: false, reason: "human_mode" };
  if (conversation.optedOutAt) return { ok: false, reason: "opted_out" };
  if (!conversation.lastInboundAt) return { ok: false, reason: "no_inbound" };
  if (now.getTime() - conversation.lastInboundAt.getTime() > DAY - MIN_WINDOW_LEFT_MS) return { ok: false, reason: "window_closing" };
  if (!conversation.patientId && conversation.lead && ["CONVERTED", "LOST"].includes(conversation.lead.status)) {
    return { ok: false, reason: "lead_closed" };
  }

  // A última mensagem precisa ser uma resposta da assistente (o contato é quem parou de responder).
  const last = await db.whatsAppMessage.findFirst({
    where: { conversationId: input.conversationId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { direction: true, origin: true, createdAt: true, sentAt: true },
  });
  if (!last || last.direction !== "OUTBOUND" || last.origin !== "ASSISTANT") return { ok: false, reason: "not_waiting_contact" };
  // Momento em que a resposta saiu (o registro pode ser anterior ao envio, ex.: reenvio).
  const silentMs = now.getTime() - (last.sentAt ?? last.createdAt).getTime();
  if (silentMs < config.agent.followUp.nudgeAfterHours * HOUR) return { ok: false, reason: "too_soon" };

  const owners = [
    ...(conversation.patientId ? [{ patientId: conversation.patientId }] : []),
    ...(conversation.leadId ? [{ leadId: conversation.leadId }] : []),
  ];
  if (owners.length > 0) {
    const upcoming = await db.appointment.count({
      where: { OR: owners, status: { in: ["SCHEDULED", "CONFIRMED"] }, startsAt: { gt: now } },
    });
    if (upcoming > 0) return { ok: false, reason: "has_appointment" };
  }

  if (nextAllowedSendTime(now, input.timeZone, config.proactive).getTime() > now.getTime()) {
    return { ok: false, reason: "outside_allowed_hours" };
  }
  const [lastDay, lastWeek] = await Promise.all([
    countProactive(db, conversation.contactPhone, new Date(now.getTime() - DAY)),
    countProactive(db, conversation.contactPhone, new Date(now.getTime() - 7 * DAY)),
  ]);
  if (lastDay >= config.proactive.maxPerDay || lastWeek >= config.proactive.maxPerWeek) return { ok: false, reason: "frequency_limit" };

  return { ok: true, hoursSilent: Math.max(1, Math.round(silentMs / HOUR)) };
}

export interface FollowUpScheduleSummary {
  /** Acompanhamentos colocados na fila do assistente. */
  queued: number;
  /** Tarefas abertas para leads parados (fora da janela). */
  staleLeadTasks: number;
}

export async function scheduleFollowUps(
  db: DbClient,
  input: { now: Date; timeZone: string; config: AssistantConfig; agentAvailable: boolean },
): Promise<FollowUpScheduleSummary> {
  const { config, now } = input;
  const summary: FollowUpScheduleSummary = { queued: 0, staleLeadTasks: 0 };
  if (!config.enabled || !config.agent.followUp.enabled) return summary;

  if (input.agentAvailable) {
    const candidates = await db.whatsAppConversation.findMany({
      where: {
        mode: "ASSISTANT",
        optedOutAt: null,
        lastInboundAt: { gte: new Date(now.getTime() - (DAY - MIN_WINDOW_LEFT_MS)) },
        lastMessageAt: { lte: new Date(now.getTime() - config.agent.followUp.nudgeAfterHours * HOUR) },
      },
      orderBy: { lastMessageAt: "asc" },
      take: 50,
      select: { id: true },
    });
    for (const candidate of candidates) {
      const eligibility = await checkFollowUpEligibility(db, { ...input, conversationId: candidate.id });
      if (!eligibility.ok) continue;
      const lastInbound = await db.whatsAppMessage.findFirst({
        where: { conversationId: candidate.id, direction: "INBOUND" },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { id: true },
      });
      if (!lastInbound) continue;
      // Um acompanhamento por mensagem do contato, no máximo (chave única).
      const created = await db.assistantRun.createMany({
        data: [{ conversationId: candidate.id, kind: "FOLLOW_UP", followUpKey: `nudge:${candidate.id}:${lastInbound.id}` }],
        skipDuplicates: true,
      });
      summary.queued += created.count;
    }
  }

  // Leads que pararam de responder há N dias: a equipe decide como retomar.
  const staleBefore = new Date(now.getTime() - config.agent.followUp.staleLeadDays * DAY);
  const stale = await db.whatsAppConversation.findMany({
    where: {
      patientId: null,
      leadId: { not: null },
      optedOutAt: null,
      lastMessageAt: { lte: staleBefore, gte: new Date(staleBefore.getTime() - 14 * DAY) },
      lead: { status: { in: ["NEW", "IN_PROGRESS"] } },
    },
    take: 50,
    select: { id: true, leadId: true, lastInboundAt: true, lastMessageAt: true, lead: { select: { name: true } } },
  });
  for (const conversation of stale) {
    // O contato é quem parou: a última mensagem foi da clínica.
    if (!conversation.lastMessageAt || (conversation.lastInboundAt && conversation.lastInboundAt >= conversation.lastMessageAt)) continue;
    const dedupeKey = `stale-lead:${conversation.leadId}:${conversation.lastMessageAt.getTime()}`;
    // Uma tarefa por período de silêncio — mesmo depois de concluída, não volta a abrir.
    const existing = await db.staffTask.findFirst({ where: { dedupeKey }, select: { id: true } });
    if (existing) continue;
    const { created } = await openTask(db, {
      kind: "FOLLOW_UP",
      title: `Lead sem resposta: ${conversation.lead ? firstName(conversation.lead.name) : "contato do WhatsApp"}`,
      details: `Sem resposta há ${config.agent.followUp.staleLeadDays}+ dias. Fora da janela de 24h, só um modelo aprovado pela Meta (ou uma ligação) pode retomar o contato.`,
      leadId: conversation.leadId,
      conversationId: conversation.id,
      dedupeKey,
      dueAt: now,
    });
    if (created) summary.staleLeadTasks += 1;
  }
  return summary;
}
