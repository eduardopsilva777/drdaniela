import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import type { MessageOrigin, ReminderChannel, TemplateUsage } from "@/generated/prisma/enums";
import type { AssistantConfig } from "@/lib/assistant-config";
import {
  addDaysToKey,
  dateKeyOf,
  dbDateToKey,
  formatKeyDayMonth,
  timeOf,
  todayKey,
  weekdayOf,
  zonedDateTime,
} from "@/lib/datetime";
import { firstName } from "@/lib/format";
import type { TemplateParameter } from "@/lib/labels";
import { recordAudit } from "@/server/audit";
import type { DbClient, DbExecutor } from "@/server/db/prisma";
import { DomainError, isUniqueViolation, NotFoundError } from "@/server/errors";
import { logger } from "@/server/logger";
import { WhatsAppSendError, type WhatsAppProvider } from "@/server/whatsapp/types";

import { assertPermission, auditContext, type Actor } from "./context";
import { openTask } from "./tasks";
import { renderTemplatePreview, resolveTemplate } from "./templates";
import { sendTemplateMessage } from "./whatsapp";

/**
 * Fila de lembretes e etapas de acompanhamento (WhatsApp). Regras:
 * - Mensagens só para quem autorizou (e não se descadastrou); modelos de
 *   marketing exigem também o consentimento de marketing. Sem autorização, a
 *   etapa de acompanhamento vira TAREFA para a equipe entrar em contato.
 * - Protocolos podem ter regras de acompanhamento (ex.: 30, 14 e 7 dias antes
 *   do retorno); sem regras, vale o lembrete padrão (REMINDER_RETURN_DAYS_BEFORE).
 * - No máximo uma etapa ativa por regra e retorno, e um lembrete por
 *   agendamento (índices parciais no banco).
 * - Antes de enviar, o processador confere se ainda faz sentido, respeita o
 *   horário permitido e o limite de mensagens por contato; só usa modelos
 *   aprovados pela Meta (fora da janela de 24h nada além disso é permitido).
 * - Resposta do paciente pausa a sequência; a equipe retoma ou cancela.
 * - Com a integração desativada, nada é enviado: as mensagens ficam pendentes
 *   (as tarefas da equipe continuam sendo criadas).
 */

export interface ReminderSettings {
  appointmentHoursBefore: number;
  returnDaysBefore: number;
  /** Horário (no fuso da clínica) para lembretes de retorno. */
  sendTime: string;
}

export const DEFAULT_REMINDER_SETTINGS: ReminderSettings = {
  appointmentHoursBefore: 24,
  returnDaysBefore: 2,
  sendTime: "09:00",
};

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
/** Espera entre tentativas: 5 min, 30 min, 2 h. */
const BACKOFF_MS = [5 * 60 * 1000, 30 * 60 * 1000, 2 * HOUR];

export function retryDelayMs(attempt: number): number {
  return BACKOFF_MS[Math.min(Math.max(attempt, 1), BACKOFF_MS.length) - 1]!;
}

type Tx = Prisma.TransactionClient | DbClient;

interface Recipient {
  phone: string;
  name: string;
  whatsapp: boolean;
  marketing: boolean;
  active: boolean;
  optedOut: boolean;
}

/** Destinatário do lembrete (paciente ou lead) com o estado atual dos consentimentos. */
async function loadRecipient(tx: Tx, subject: { patientId?: string | null; leadId?: string | null }): Promise<Recipient | null> {
  let recipient: Omit<Recipient, "optedOut"> | null = null;
  if (subject.patientId) {
    const patient = await tx.patient.findUnique({
      where: { id: subject.patientId },
      select: { fullName: true, preferredName: true, phone: true, whatsappOptIn: true, marketingOptIn: true, isActive: true },
    });
    if (patient) {
      recipient = {
        phone: patient.phone,
        name: patient.preferredName ?? firstName(patient.fullName),
        whatsapp: patient.whatsappOptIn,
        marketing: patient.marketingOptIn,
        active: patient.isActive,
      };
    }
  } else if (subject.leadId) {
    const lead = await tx.lead.findUnique({
      where: { id: subject.leadId },
      select: { name: true, phone: true, whatsappOptIn: true, status: true },
    });
    if (lead) {
      recipient = {
        phone: lead.phone,
        name: firstName(lead.name),
        whatsapp: lead.whatsappOptIn,
        marketing: false,
        active: lead.status !== "LOST" && lead.status !== "CONVERTED",
      };
    }
  }
  if (!recipient) return null;
  const conversation = await tx.whatsAppConversation.findUnique({
    where: { contactPhone: recipient.phone },
    select: { optedOutAt: true },
  });
  return { ...recipient, optedOut: Boolean(conversation?.optedOutAt) };
}

function canMessage(recipient: Recipient | null): recipient is Recipient {
  return Boolean(recipient && recipient.active && recipient.whatsapp && !recipient.optedOut);
}

/** Cancela lembretes ativos de um agendamento ou retorno (ex.: remarcado, resolvido). */
export async function cancelPendingReminders(
  tx: Tx,
  where: { appointmentId?: string; returnId?: string },
  reason: string,
  now: Date,
) {
  if (!where.appointmentId && !where.returnId) return 0;
  const result = await tx.reminder.updateMany({
    where: { ...where, status: { in: ["PENDING", "PAUSED"] } },
    data: { status: "CANCELLED", cancelledAt: now, lastError: reason.slice(0, 300) },
  });
  return result.count;
}

/**
 * INSERT ... ON CONFLICT DO NOTHING: se já existe etapa ativa para o mesmo item
 * (índice parcial único), nada é criado — sem abortar a transação em andamento.
 */
async function createReminderSafely(tx: Tx, data: Prisma.ReminderCreateManyInput): Promise<boolean> {
  const result = await tx.reminder.createMany({ data: [data], skipDuplicates: true });
  return result.count === 1;
}

export async function scheduleAppointmentReminder(
  tx: Tx,
  appointment: { id: string; patientId: string | null; leadId?: string | null; procedureId: string | null; startsAt: Date },
  settings: ReminderSettings,
  now: Date,
) {
  const subject = appointment.patientId ? { patientId: appointment.patientId } : appointment.leadId ? { leadId: appointment.leadId } : null;
  if (!subject) return false;
  if (!canMessage(await loadRecipient(tx, subject))) return false;
  let scheduledFor = new Date(appointment.startsAt.getTime() - settings.appointmentHoursBefore * HOUR);
  if (scheduledFor.getTime() <= now.getTime()) {
    // Agendado em cima da hora: avisa já, se ainda houver pelo menos 2 horas.
    if (appointment.startsAt.getTime() - now.getTime() < 2 * HOUR) return false;
    scheduledFor = now;
  }
  await cancelPendingReminders(tx, { appointmentId: appointment.id }, "Substituído por novo lembrete.", now);
  return createReminderSafely(tx, {
    kind: "APPOINTMENT",
    patientId: appointment.patientId,
    leadId: appointment.patientId ? null : (appointment.leadId ?? null),
    appointmentId: appointment.id,
    procedureId: appointment.procedureId,
    scheduledFor,
  });
}

/**
 * Programa o acompanhamento de um retorno: as etapas das regras do protocolo
 * (ou o lembrete padrão). Reprograma do zero a cada chamada (ex.: data alterada).
 */
export async function scheduleReturnReminder(
  tx: Tx,
  patientReturn: { id: string; patientId: string; procedureId: string | null; dueDate: Date },
  settings: ReminderSettings,
  clock: { timeZone: string; now: Date },
) {
  const dueKey = dbDateToKey(patientReturn.dueDate);
  const today = todayKey(clock.timeZone, clock.now);
  await cancelPendingReminders(tx, { returnId: patientReturn.id }, "Substituído por nova programação.", clock.now);
  if (dueKey < today) return false; // retornos atrasados ficam com a equipe

  const details = await tx.patientReturn.findUnique({
    where: { id: patientReturn.id },
    select: {
      protocolStep: { select: { kind: true } },
      patientProtocol: {
        select: {
          protocol: {
            select: { followUpRules: { orderBy: { daysBefore: "desc" }, include: { template: { select: { category: true } } } } },
          },
        },
      },
    },
  });
  const stepKind = details?.protocolStep?.kind ?? null;
  const rules = (details?.patientProtocol?.protocol.followUpRules ?? []).filter(
    (rule) => rule.stepKinds.length === 0 || (stepKind !== null && rule.stepKinds.includes(stepKind)),
  );
  const recipient = await loadRecipient(tx, { patientId: patientReturn.patientId });
  const base = { kind: "RETURN" as const, patientId: patientReturn.patientId, returnId: patientReturn.id, procedureId: patientReturn.procedureId };

  if (rules.length === 0) {
    if (!canMessage(recipient)) return false;
    let scheduledFor = zonedDateTime(addDaysToKey(dueKey, -settings.returnDaysBefore), settings.sendTime, clock.timeZone);
    if (scheduledFor.getTime() < clock.now.getTime()) scheduledFor = clock.now;
    return createReminderSafely(tx, { ...base, scheduledFor });
  }

  const channelFor = (rule: (typeof rules)[number]): ReminderChannel => {
    if (rule.action === "TASK") return "TASK";
    const marketing = rule.template?.category === "MARKETING";
    // Sem autorização para mensagens automáticas, a etapa vira contato manual da equipe.
    return canMessage(recipient) && (!marketing || recipient.marketing) ? "WHATSAPP" : "TASK";
  };

  let created = 0;
  const past: typeof rules = [];
  for (const rule of rules) {
    const scheduledFor = zonedDateTime(addDaysToKey(dueKey, -rule.daysBefore), settings.sendTime, clock.timeZone);
    if (scheduledFor.getTime() < clock.now.getTime()) {
      past.push(rule);
      continue;
    }
    if (await createReminderSafely(tx, { ...base, channel: channelFor(rule), followUpRuleId: rule.id, scheduledFor })) created += 1;
  }
  // Retorno programado em cima da hora: só a etapa mais próxima da data é feita agora.
  if (created === 0 && past.length > 0) {
    const closest = past.reduce((a, b) => (a.daysBefore <= b.daysBefore ? a : b));
    if (await createReminderSafely(tx, { ...base, channel: channelFor(closest), followUpRuleId: closest.id, scheduledFor: clock.now })) {
      created += 1;
    }
  }
  return created > 0;
}

// -----------------------------------------------------------------------------
// Sequências: pausa (resposta do paciente), retomada e cancelamento
// -----------------------------------------------------------------------------

/** O paciente respondeu: etapas automáticas pendentes ficam pausadas até a equipe decidir. */
export async function pauseFollowUpsOnReply(db: DbExecutor, patientId: string, now: Date) {
  const result = await db.reminder.updateMany({
    where: { patientId, kind: "RETURN", status: "PENDING" },
    data: { status: "PAUSED", pausedAt: now, lastError: "Pausado: o paciente respondeu pelo WhatsApp." },
  });
  return result.count;
}

export async function pauseReturnSequence(db: DbClient, actor: Actor, returnId: string, now: Date = new Date()) {
  assertPermission(actor, "returns:write");
  return db.$transaction(async (tx) => {
    const result = await tx.reminder.updateMany({
      where: { returnId, status: "PENDING" },
      data: { status: "PAUSED", pausedAt: now, lastError: "Pausado pela equipe." },
    });
    if (result.count === 0) throw new DomainError("Não há etapas pendentes para pausar neste retorno.");
    await recordAudit(tx, { ...auditContext(actor), action: "follow_up.pause", entityType: "patient_return", entityId: returnId });
    return result.count;
  });
}

/**
 * Retoma a sequência. Etapas que venceram durante a pausa não disparam todas
 * de uma vez: só a mais recente é feita agora; as anteriores são canceladas.
 */
export async function resumeReturnSequence(db: DbClient, actor: Actor, returnId: string, now: Date = new Date()) {
  assertPermission(actor, "returns:write");
  return db.$transaction(async (tx) => {
    const patientReturn = await tx.patientReturn.findUnique({ where: { id: returnId }, select: { status: true } });
    if (!patientReturn) throw new NotFoundError("Retorno");
    if (patientReturn.status !== "PENDING") throw new DomainError("O retorno já foi resolvido ou agendado.");
    const paused = await tx.reminder.findMany({ where: { returnId, status: "PAUSED" }, orderBy: { scheduledFor: "asc" } });
    if (paused.length === 0) throw new DomainError("Não há etapas pausadas neste retorno.");
    const overdue = paused.filter((item) => item.scheduledFor.getTime() <= now.getTime());
    const keep = overdue.at(-1);
    for (const item of overdue) {
      if (item.id === keep?.id) continue;
      await tx.reminder.update({
        where: { id: item.id },
        data: { status: "CANCELLED", cancelledAt: now, lastError: "Etapa vencida durante a pausa." },
      });
    }
    await tx.reminder.updateMany({
      where: { returnId, status: "PAUSED" },
      data: { status: "PENDING", pausedAt: null, lastError: null },
    });
    if (keep) await tx.reminder.update({ where: { id: keep.id }, data: { scheduledFor: now } });
    await recordAudit(tx, { ...auditContext(actor), action: "follow_up.resume", entityType: "patient_return", entityId: returnId });
  });
}

export async function cancelReturnSequence(db: DbClient, actor: Actor, returnId: string, now: Date = new Date()) {
  assertPermission(actor, "returns:write");
  return db.$transaction(async (tx) => {
    const count = await cancelPendingReminders(tx, { returnId }, "Sequência cancelada pela equipe.", now);
    if (count === 0) throw new DomainError("Não há etapas pendentes ou pausadas neste retorno.");
    await recordAudit(tx, { ...auditContext(actor), action: "follow_up.cancel", entityType: "patient_return", entityId: returnId });
    return count;
  });
}

// -----------------------------------------------------------------------------
// Processamento da fila
// -----------------------------------------------------------------------------

export interface QueueDependencies {
  provider: WhatsAppProvider | null;
  timeZone: string;
  language: string;
  templates: { returnReminder?: string; appointmentReminder?: string };
  /** Horário permitido e limites de mensagens proativas (configurações do assistente). */
  proactive?: AssistantConfig["proactive"];
  clinicName?: string;
}

export interface QueueSummary {
  claimed: number;
  sent: number;
  simulated: number;
  retried: number;
  failed: number;
  cancelled: number;
  /** Adiados por horário permitido ou limite de frequência. */
  deferred: number;
  /** Tarefas criadas para a equipe (etapas de contato manual). */
  tasks: number;
  skippedReason?: string;
}

/** Próximo instante permitido para mensagens proativas (o próprio `from`, se já estiver na janela). */
export function nextAllowedSendTime(from: Date, timeZone: string, proactive: AssistantConfig["proactive"]): Date {
  const today = todayKey(timeZone, from);
  for (let offset = 0; offset <= 7; offset += 1) {
    const key = addDaysToKey(today, offset);
    if (!proactive.allowedWeekdays.includes(weekdayOf(key))) continue;
    const start = zonedDateTime(key, proactive.startTime, timeZone);
    const end = zonedDateTime(key, proactive.endTime, timeZone);
    if (from.getTime() < start.getTime()) return start;
    if (from.getTime() < end.getTime()) return from;
  }
  return from;
}

/** Reserva itens vencidos para este processador (seguro com execuções simultâneas). */
async function claimDueReminders(db: DbClient, now: Date, limit: number, channels: ReminderChannel[]): Promise<string[]> {
  const rows = await db.$queryRaw<Array<{ id: string }>>`
    UPDATE "reminders" SET "status" = 'PROCESSING', "locked_at" = ${now}, "updated_at" = ${now}
    WHERE "id" IN (
      SELECT "id" FROM "reminders"
      WHERE "status" = 'PENDING'
        AND "scheduled_for" <= ${now}
        AND ("next_attempt_at" IS NULL OR "next_attempt_at" <= ${now})
        AND "channel"::text = ANY(${channels})
      ORDER BY "scheduled_for" ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING "id"`;
  return rows.map((row) => row.id);
}

/** Mensagens proativas já enviadas ao número no período (lembretes e acompanhamento). */
function countProactive(db: DbClient, phone: string, since: Date) {
  return db.whatsAppMessage.count({
    where: {
      conversation: { contactPhone: phone },
      direction: "OUTBOUND",
      origin: { in: ["REMINDER", "FOLLOW_UP"] },
      status: { not: "FAILED" },
      createdAt: { gte: since },
    },
  });
}

export async function processReminderQueue(
  db: DbClient,
  deps: QueueDependencies,
  options: { now?: Date; limit?: number; staleLockMinutes?: number } = {},
): Promise<QueueSummary> {
  const now = options.now ?? new Date();
  const summary: QueueSummary = { claimed: 0, sent: 0, simulated: 0, retried: 0, failed: 0, cancelled: 0, deferred: 0, tasks: 0 };

  // Itens presos em PROCESSING (ex.: processo interrompido) voltam para a fila.
  await db.reminder.updateMany({
    where: { status: "PROCESSING", lockedAt: { lt: new Date(now.getTime() - (options.staleLockMinutes ?? 15) * 60 * 1000) } },
    data: { status: "PENDING", lockedAt: null },
  });

  // Sem provedor, só as tarefas da equipe seguem; as mensagens continuam pendentes.
  const channels: ReminderChannel[] = deps.provider ? ["WHATSAPP", "TASK"] : ["TASK"];
  if (!deps.provider) summary.skippedReason = "Integração com o WhatsApp desativada: as mensagens continuam pendentes.";

  const ids = await claimDueReminders(db, now, options.limit ?? 25, channels);
  summary.claimed = ids.length;

  for (const id of ids) {
    try {
      await processOne(db, deps, id, now, summary);
    } catch (error) {
      // Falha inesperada num item não interrompe a fila: o item volta para a fila mais tarde.
      logger.error("reminders.process.unexpected", { err: error });
      await db.reminder.update({
        where: { id },
        data: { status: "PENDING", lockedAt: null, nextAttemptAt: new Date(now.getTime() + retryDelayMs(1)) },
      });
      summary.retried += 1;
    }
  }
  return summary;
}

async function processOne(db: DbClient, deps: QueueDependencies, id: string, now: Date, summary: QueueSummary) {
  const reminder = await db.reminder.findUniqueOrThrow({
    where: { id },
    include: {
      patient: { select: { id: true, fullName: true } },
      lead: { select: { id: true, name: true } },
      procedure: { select: { name: true } },
      appointment: { select: { startsAt: true, status: true } },
      return: { select: { dueDate: true, status: true, title: true } },
      followUpRule: { select: { id: true, action: true, taskTitle: true, templateId: true } },
    },
  });

  const release = (data: Prisma.ReminderUncheckedUpdateInput) => db.reminder.update({ where: { id }, data: { lockedAt: null, ...data } });
  const cancel = async (reason: string) => {
    await release({ status: "CANCELLED", cancelledAt: now, lastError: reason.slice(0, 300) });
    summary.cancelled += 1;
  };

  // O item ainda faz sentido?
  if (reminder.kind === "APPOINTMENT") {
    const appointment = reminder.appointment;
    if (!appointment || !["SCHEDULED", "CONFIRMED"].includes(appointment.status) || appointment.startsAt <= now) {
      return cancel("Agendamento cancelado, concluído ou já iniciado.");
    }
  } else if (!reminder.return || !["PENDING", "SCHEDULED"].includes(reminder.return.status)) {
    return cancel("Retorno resolvido ou cancelado.");
  }

  const subjectName = reminder.patient?.fullName ?? reminder.lead?.name ?? "Contato";
  const procedureName = reminder.procedure?.name ?? "seu procedimento";

  // Etapa executada pela equipe: vira tarefa (não depende do WhatsApp nem de consentimento).
  if (reminder.channel === "TASK") {
    const returnTitle = reminder.return?.title ?? procedureName;
    const manual = reminder.followUpRule?.action === "MESSAGE";
    const title = reminder.followUpRule?.taskTitle ?? (manual ? "Contato de acompanhamento (sem autorização para mensagens automáticas)" : "Contato de acompanhamento");
    const due = reminder.return ? formatKeyDayMonth(dbDateToKey(reminder.return.dueDate)) : "";
    const { created } = await openTask(db, {
      kind: "FOLLOW_UP",
      title: `${title} — ${firstName(subjectName)}`,
      details: `${returnTitle}${due ? `, previsto para ${due}` : ""}. Convite para agendar; a decisão clínica é da profissional.`,
      patientId: reminder.patientId,
      leadId: reminder.leadId,
      returnId: reminder.returnId,
      reminderId: reminder.id,
      dueAt: now,
    });
    await release({ status: "SENT", sentAt: now, attempts: { increment: 1 }, lastError: null });
    if (created) summary.tasks += 1;
    return;
  }

  const provider = deps.provider!;
  const recipient = await loadRecipient(db, { patientId: reminder.patientId, leadId: reminder.leadId });
  if (!recipient || !recipient.active) return cancel("Contato inativo.");
  if (recipient.optedOut) return cancel("Contato pediu para não receber mensagens (descadastro).");
  if (!recipient.whatsapp) return cancel("Sem consentimento para mensagens pelo WhatsApp.");

  // Horário permitido e limite de frequência (mensagens iniciadas pela clínica).
  if (deps.proactive) {
    const allowedAt = nextAllowedSendTime(now, deps.timeZone, deps.proactive);
    if (allowedAt.getTime() > now.getTime()) {
      if (reminder.kind === "APPOINTMENT" && allowedAt.getTime() > reminder.appointment!.startsAt.getTime() - 2 * HOUR) {
        return cancel("Fora do horário permitido para mensagens antes do atendimento.");
      }
      await release({ status: "PENDING", scheduledFor: allowedAt });
      summary.deferred += 1;
      return;
    }
    if (reminder.kind === "RETURN") {
      const [lastDay, lastWeek] = await Promise.all([
        countProactive(db, recipient.phone, new Date(now.getTime() - DAY)),
        countProactive(db, recipient.phone, new Date(now.getTime() - 7 * DAY)),
      ]);
      if (lastDay >= deps.proactive.maxPerDay || lastWeek >= deps.proactive.maxPerWeek) {
        const tomorrow = zonedDateTime(addDaysToKey(todayKey(deps.timeZone, now), 1), "00:00", deps.timeZone);
        await release({ status: "PENDING", scheduledFor: nextAllowedSendTime(tomorrow, deps.timeZone, deps.proactive) });
        summary.deferred += 1;
        return;
      }
    }
  }

  const usage: TemplateUsage = reminder.kind === "APPOINTMENT" ? "APPOINTMENT_REMINDER" : reminder.followUpRule ? "FOLLOW_UP" : "RETURN_REMINDER";
  const template = await resolveTemplate(
    db,
    usage,
    {
      language: deps.language,
      appointmentReminder: deps.templates.appointmentReminder,
      returnReminder: deps.templates.returnReminder,
      developmentFallback: provider.name === "development",
    },
    reminder.followUpRule?.templateId ?? null,
  );

  const values: Record<TemplateParameter, string> = {
    patient_name: recipient.name,
    procedure_name: procedureName,
    due_date: reminder.return ? formatKeyDayMonth(dbDateToKey(reminder.return.dueDate)) : "",
    appointment_date: reminder.appointment ? formatKeyDayMonth(dateKeyOf(reminder.appointment.startsAt, deps.timeZone)) : "",
    appointment_time: reminder.appointment ? timeOf(reminder.appointment.startsAt, deps.timeZone) : "",
    clinic_name: deps.clinicName ?? "",
  };

  const origin: MessageOrigin = reminder.followUpRule ? "FOLLOW_UP" : "REMINDER";
  const attempt = reminder.attempts + 1;

  try {
    if ("error" in template) throw new WhatsAppSendError(template.error, "template_not_approved", false);
    if (template.category === "MARKETING" && !recipient.marketing) {
      return cancel("Modelo de marketing sem consentimento de marketing do contato.");
    }
    // Proteção contra envio duplicado: se uma tentativa anterior ficou sem resultado
    // conhecido (processo interrompido após o envio), não reenvia às cegas.
    const unknownOutcome = await db.whatsAppMessage.findFirst({
      where: { idempotencyKey: { startsWith: `reminder:${id}:` }, status: "PENDING" },
      select: { id: true },
    });
    if (unknownOutcome) {
      throw new WhatsAppSendError(
        "Tentativa anterior sem confirmação do provedor: confira a conversa antes de reenviar.",
        "unknown_previous_attempt",
        false,
      );
    }

    const parameters = template.parameters.map((parameter) => values[parameter] ?? "");
    const preview = template.body
      ? renderTemplatePreview(template.body, parameters)
      : reminder.kind === "APPOINTMENT"
        ? `Olá, ${recipient.name}! Lembrete do seu horário na clínica em ${values.appointment_date} às ${values.appointment_time} (${procedureName}).`
        : `Olá, ${recipient.name}! Seu retorno de ${procedureName} está previsto para ${values.due_date}. Responda esta mensagem para agendar.`;

    const result = await sendTemplateMessage(
      db,
      provider,
      {
        phone: recipient.phone,
        templateName: template.name,
        language: template.language,
        parameters,
        preview,
        origin,
        idempotencyKey: `reminder:${id}:${attempt}:${now.getTime()}`,
      },
      now,
    );
    await release({
      status: "SENT",
      sentAt: now,
      attempts: attempt,
      simulated: result.status === "SIMULATED",
      messageId: result.messageId,
      lastError: null,
    });
    if (result.status === "SIMULATED") summary.simulated += 1;
    else summary.sent += 1;
  } catch (error) {
    const failure =
      error instanceof WhatsAppSendError ? error : new WhatsAppSendError("Falha inesperada no envio.", "unexpected", false);
    if (!(error instanceof WhatsAppSendError)) logger.error("reminders.send.unexpected", { err: error });
    const exhausted = !failure.retryable || attempt >= reminder.maxAttempts;
    const messageId = (error as { messageId?: string }).messageId;
    await release({
      status: exhausted ? "FAILED" : "PENDING",
      attempts: attempt,
      nextAttemptAt: exhausted ? null : new Date(now.getTime() + retryDelayMs(attempt)),
      lastError: failure.message.slice(0, 300),
      ...(messageId ? { messageId } : {}),
    });
    if (exhausted) {
      summary.failed += 1;
      await openTask(db, {
        kind: "AUTOMATION_FAILURE",
        title: `Mensagem automática não enviada — ${firstName(subjectName)}`,
        details: failure.message,
        patientId: reminder.patientId,
        leadId: reminder.leadId,
        returnId: reminder.returnId,
        dedupeKey: `reminder-failure:${id}`,
      });
    } else {
      summary.retried += 1;
    }
  }
}

export async function cancelReminder(db: DbClient, actor: Actor, reminderId: string, now: Date = new Date()) {
  assertPermission(actor, "returns:write");
  return db.$transaction(async (tx) => {
    const reminder = await tx.reminder.findUnique({ where: { id: reminderId }, select: { id: true, status: true } });
    if (!reminder) throw new NotFoundError("Lembrete");
    if (reminder.status !== "PENDING" && reminder.status !== "FAILED" && reminder.status !== "PAUSED") {
      throw new DomainError("Só é possível cancelar lembretes pendentes, pausados ou com falha.");
    }
    await tx.reminder.update({
      where: { id: reminderId },
      data: { status: "CANCELLED", cancelledAt: now, lastError: "Cancelado pela equipe." },
    });
    await recordAudit(tx, { ...auditContext(actor), action: "reminder.cancel", entityType: "reminder", entityId: reminderId });
  });
}

/** Recoloca na fila um lembrete que falhou (ex.: após corrigir o modelo ou a credencial). */
export async function retryReminder(db: DbClient, actor: Actor, reminderId: string, now: Date = new Date()) {
  assertPermission(actor, "returns:write");
  return db.$transaction(async (tx) => {
    const reminder = await tx.reminder.findUnique({ where: { id: reminderId }, select: { id: true, status: true } });
    if (!reminder) throw new NotFoundError("Lembrete");
    if (reminder.status !== "FAILED") throw new DomainError("Só lembretes com falha podem ser reenviados.");
    try {
      await tx.reminder.update({
        where: { id: reminderId },
        data: { status: "PENDING", attempts: 0, nextAttemptAt: null, scheduledFor: now, lastError: null },
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new DomainError("Já existe outro lembrete ativo para o mesmo item.");
      }
      throw error;
    }
    // A tentativa sem resultado conhecido foi conferida pela equipe: não bloqueia o reenvio.
    await tx.whatsAppMessage.updateMany({
      where: { idempotencyKey: { startsWith: `reminder:${reminderId}:` }, status: "PENDING" },
      data: { status: "FAILED", failedAt: now, errorCode: "unknown_outcome", errorMessage: "Resultado desconhecido; conferido pela equipe." },
    });
    await recordAudit(tx, { ...auditContext(actor), action: "reminder.retry", entityType: "reminder", entityId: reminderId });
  });
}
