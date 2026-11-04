import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import type { ProtocolStepKind, ReturnStatus } from "@/generated/prisma/enums";
import {
  addDaysToKey,
  dateKeyOf,
  dateKeyToDbDate,
  dbDateToKey,
  todayKey,
  zonedDateTime,
} from "@/lib/datetime";
import { computeStepDueDates, recomputeAfterCompletion } from "@/lib/protocol-schedule";
import type { FollowUpRuleInput } from "@/lib/validation/assistant";
import type {
  ApplyProtocolInput,
  ProcedureRecordInput,
  ProtocolInput,
  ReturnCreateInput,
  ReturnResolveInput,
  ReturnUpdateInput,
} from "@/lib/validation/care";
import { recordAudit } from "@/server/audit";
import type { DbClient } from "@/server/db/prisma";
import { DomainError, isUniqueViolation, NotFoundError } from "@/server/errors";

import { assertPermission, auditContext, type Actor } from "./context";
import type { ServiceClock } from "./leads";
import {
  cancelPendingReminders,
  DEFAULT_REMINDER_SETTINGS,
  scheduleReturnReminder,
  type ReminderSettings,
} from "./reminders";

/**
 * Protocolos (catálogo), procedimentos realizados e retornos programados.
 * As datas vêm exclusivamente dos intervalos configurados pela profissional.
 */

export interface CareClock extends ServiceClock {
  reminders?: ReminderSettings;
}

function nowOf(clock: CareClock) {
  return clock.now ?? new Date();
}

/**
 * Momento de um procedimento realizado. Sem horário informado: hoje usa o
 * instante atual (nunca "no futuro"); dias anteriores usam meio-dia local.
 */
function performedAtFor(dateKey: string, time: string | undefined, clock: CareClock): Date {
  const now = nowOf(clock);
  if (time) return zonedDateTime(dateKey, time, clock.timeZone);
  return dateKey === todayKey(clock.timeZone, now) ? now : zonedDateTime(dateKey, "12:00", clock.timeZone);
}

const OPEN_RETURN: ReturnStatus[] = ["PENDING", "SCHEDULED", "MISSED"];

// ---------------------------------------------------------------------------
// Catálogo de protocolos
// ---------------------------------------------------------------------------

function duplicateProtocolName(): DomainError {
  const message = "Já existe um protocolo com este nome.";
  return new DomainError(message, { fieldErrors: { name: [message] } });
}

async function assertProcedure(db: Prisma.TransactionClient | DbClient, procedureId: string) {
  const procedure = await db.procedure.findUnique({ where: { id: procedureId }, select: { id: true } });
  if (!procedure) throw new DomainError("Procedimento inválido.", { fieldErrors: { procedureId: ["Selecione um procedimento válido."] } });
}

/**
 * Regras de acompanhamento do protocolo. Valem para os retornos programados
 * daqui em diante; etapas já agendadas de regras removidas são canceladas.
 */
async function syncFollowUpRules(tx: Prisma.TransactionClient, protocolId: string, rules: FollowUpRuleInput[], now: Date) {
  const templateIds = [...new Set(rules.flatMap((rule) => (rule.action === "MESSAGE" && rule.templateId ? [rule.templateId] : [])))];
  if (templateIds.length > 0) {
    const found = await tx.messageTemplate.count({ where: { id: { in: templateIds } } });
    if (found !== templateIds.length) throw new DomainError("Modelo de mensagem inválido em uma das regras de acompanhamento.");
  }
  const keyOf = (rule: { daysBefore: number; action: string }) => `${rule.daysBefore}:${rule.action}`;
  const wanted = new Set(rules.map(keyOf));
  const existing = await tx.followUpRule.findMany({ where: { protocolId }, select: { id: true, daysBefore: true, action: true } });
  for (const rule of existing) {
    if (wanted.has(keyOf(rule))) continue;
    await tx.reminder.updateMany({
      where: { followUpRuleId: rule.id, status: { in: ["PENDING", "PAUSED"] } },
      data: { status: "CANCELLED", cancelledAt: now, lastError: "Regra de acompanhamento removida do protocolo." },
    });
    await tx.followUpRule.delete({ where: { id: rule.id } });
  }
  for (const rule of rules) {
    const data = {
      templateId: rule.action === "MESSAGE" ? (rule.templateId ?? null) : null,
      taskTitle: rule.taskTitle ?? null,
      stepKinds: rule.stepKinds,
    };
    await tx.followUpRule.upsert({
      where: { protocolId_daysBefore_action: { protocolId, daysBefore: rule.daysBefore, action: rule.action } },
      create: { protocolId, daysBefore: rule.daysBefore, action: rule.action, ...data },
      update: data,
    });
  }
}

export async function createProtocol(db: DbClient, actor: Actor, input: ProtocolInput) {
  assertPermission(actor, "procedures:manage");
  try {
    return await db.$transaction(async (tx) => {
      await assertProcedure(tx, input.procedureId);
      const protocol = await tx.protocol.create({
        data: {
          name: input.name,
          procedureId: input.procedureId,
          description: input.description ?? null,
          durationDays: input.durationDays ?? null,
          steps: {
            create: input.steps.map((step, index) => ({
              position: index + 1,
              label: step.label,
              kind: step.kind,
              offsetDays: step.offsetDays,
              relativeTo: step.relativeTo,
            })),
          },
        },
      });
      await syncFollowUpRules(tx, protocol.id, input.followUpRules, new Date());
      await recordAudit(tx, { ...auditContext(actor), action: "protocol.create", entityType: "protocol", entityId: protocol.id });
      return protocol;
    });
  } catch (error) {
    if (isUniqueViolation(error, "name")) throw duplicateProtocolName();
    throw error;
  }
}

/**
 * Alterações valem para novas aplicações. Retornos já programados mantêm suas
 * datas; etapas são atualizadas por posição (removidas só no fim da lista).
 */
export async function updateProtocol(db: DbClient, actor: Actor, protocolId: string, input: ProtocolInput) {
  assertPermission(actor, "procedures:manage");
  try {
    return await db.$transaction(async (tx) => {
      const protocol = await tx.protocol.findUnique({ where: { id: protocolId }, include: { steps: true } });
      if (!protocol) throw new NotFoundError("Protocolo");
      await assertProcedure(tx, input.procedureId);
      await tx.protocol.update({
        where: { id: protocolId },
        data: {
          name: input.name,
          procedureId: input.procedureId,
          description: input.description ?? null,
          durationDays: input.durationDays ?? null,
        },
      });
      await syncFollowUpRules(tx, protocolId, input.followUpRules, new Date());
      for (const [index, step] of input.steps.entries()) {
        const position = index + 1;
        const existing = protocol.steps.find((item) => item.position === position);
        const data = { label: step.label, kind: step.kind, offsetDays: step.offsetDays, relativeTo: step.relativeTo };
        if (existing) await tx.protocolStep.update({ where: { id: existing.id }, data });
        else await tx.protocolStep.create({ data: { ...data, protocolId, position } });
      }
      await tx.protocolStep.deleteMany({ where: { protocolId, position: { gt: input.steps.length } } });
      await recordAudit(tx, { ...auditContext(actor), action: "protocol.update", entityType: "protocol", entityId: protocolId });
      return { id: protocolId };
    });
  } catch (error) {
    if (isUniqueViolation(error, "name")) throw duplicateProtocolName();
    throw error;
  }
}

export async function setProtocolActive(db: DbClient, actor: Actor, protocolId: string, isActive: boolean) {
  assertPermission(actor, "procedures:manage");
  return db.$transaction(async (tx) => {
    const protocol = await tx.protocol.findUnique({ where: { id: protocolId }, select: { id: true } });
    if (!protocol) throw new NotFoundError("Protocolo");
    await tx.protocol.update({ where: { id: protocolId }, data: { isActive } });
    await recordAudit(tx, {
      ...auditContext(actor),
      action: isActive ? "protocol.activate" : "protocol.deactivate",
      entityType: "protocol",
      entityId: protocolId,
    });
  });
}

// ---------------------------------------------------------------------------
// Aplicação de protocolo ao paciente
// ---------------------------------------------------------------------------

const STEP_TO_RETURN_KIND: Record<ProtocolStepKind, "SESSION" | "REVIEW" | "MAINTENANCE"> = {
  SESSION: "SESSION",
  REVIEW: "REVIEW",
  MAINTENANCE: "MAINTENANCE",
};

export async function applyProtocolToPatient(
  db: DbClient,
  actor: Actor,
  patientId: string,
  input: ApplyProtocolInput,
  clock: CareClock,
) {
  assertPermission(actor, "protocols:assign");
  const now = nowOf(clock);
  const settings = clock.reminders ?? DEFAULT_REMINDER_SETTINGS;

  const [patient, protocol] = await Promise.all([
    db.patient.findUnique({ where: { id: patientId }, select: { id: true, isActive: true } }),
    db.protocol.findUnique({ where: { id: input.protocolId }, include: { steps: { orderBy: { position: "asc" } }, procedure: true } }),
  ]);
  if (!patient) throw new NotFoundError("Paciente");
  if (!patient.isActive) throw new DomainError("Reative o paciente antes de aplicar um protocolo.");
  if (!protocol || !protocol.isActive) throw new DomainError("Protocolo inválido ou inativo.", { fieldErrors: { protocolId: ["Selecione um protocolo ativo."] } });
  if (protocol.steps.length === 0) throw new DomainError("Este protocolo não tem etapas cadastradas.");
  if (input.registerInitialProcedure && input.startDate > todayKey(clock.timeZone, now)) {
    const message = "O procedimento inicial só pode ser registrado depois de realizado. Desmarque a opção ou use a data de hoje.";
    throw new DomainError(message, { fieldErrors: { startDate: [message] } });
  }

  const dues = computeStepDueDates(input.startDate, protocol.steps);

  return db.$transaction(async (tx) => {
    const patientProtocol = await tx.patientProtocol.create({
      data: {
        patientId,
        protocolId: protocol.id,
        startedOn: dateKeyToDbDate(input.startDate),
        notes: input.notes ?? null,
      },
    });

    let sourceRecordId: string | null = null;
    if (input.registerInitialProcedure) {
      const record = await tx.procedureRecord.create({
        data: {
          patientId,
          procedureId: protocol.procedureId,
          professionalId: input.professionalId ?? actor.id,
          patientProtocolId: patientProtocol.id,
          performedAt: performedAtFor(input.startDate, undefined, clock),
        },
      });
      sourceRecordId = record.id;
      await recordAudit(tx, { ...auditContext(actor), action: "procedure_record.create", entityType: "procedure_record", entityId: record.id });
    }

    for (const step of protocol.steps) {
      const created = await tx.patientReturn.create({
        data: {
          patientId,
          procedureId: protocol.procedureId,
          patientProtocolId: patientProtocol.id,
          protocolStepId: step.id,
          sourceRecordId,
          kind: STEP_TO_RETURN_KIND[step.kind],
          title: step.label,
          dueDate: dateKeyToDbDate(dues.get(step.id)!),
        },
      });
      await scheduleReturnReminder(tx, created, settings, { timeZone: clock.timeZone, now });
    }

    await tx.interaction.create({
      data: {
        patientId,
        type: "SYSTEM",
        content: `Protocolo “${protocol.name}” aplicado com início em ${input.startDate.split("-").reverse().join("/")}.`,
        authorId: actor.id,
        occurredAt: now,
      },
    });
    await recordAudit(tx, {
      ...auditContext(actor),
      action: "patient_protocol.apply",
      entityType: "patient_protocol",
      entityId: patientProtocol.id,
      metadata: { steps: protocol.steps.length },
    });
    return { id: patientProtocol.id };
  });
}

export async function cancelPatientProtocol(
  db: DbClient,
  actor: Actor,
  patientProtocolId: string,
  reason: string,
  clock: CareClock,
) {
  assertPermission(actor, "protocols:assign");
  const now = nowOf(clock);
  return db.$transaction(async (tx) => {
    const patientProtocol = await tx.patientProtocol.findUnique({ where: { id: patientProtocolId }, select: { id: true, status: true } });
    if (!patientProtocol) throw new NotFoundError("Protocolo do paciente");
    if (patientProtocol.status !== "ACTIVE") throw new DomainError("Este protocolo já foi encerrado.");

    await tx.patientProtocol.update({
      where: { id: patientProtocolId },
      data: { status: "CANCELLED", cancelledAt: now, cancellationReason: reason },
    });
    const openReturns = await tx.patientReturn.findMany({
      where: { patientProtocolId, status: { in: ["PENDING", "MISSED"] } },
      select: { id: true },
    });
    for (const item of openReturns) {
      await cancelPendingReminders(tx, { returnId: item.id }, "Protocolo cancelado.", now);
    }
    await tx.patientReturn.updateMany({
      where: { patientProtocolId, status: { in: ["PENDING", "MISSED"] } },
      data: { status: "CANCELLED", resolvedAt: now },
    });
    await recordAudit(tx, {
      ...auditContext(actor),
      action: "patient_protocol.cancel",
      entityType: "patient_protocol",
      entityId: patientProtocolId,
    });
  });
}

/** Encerra o protocolo automaticamente quando todos os retornos foram resolvidos. */
async function completeProtocolIfDone(tx: Prisma.TransactionClient, patientProtocolId: string | null) {
  if (!patientProtocolId) return;
  const open = await tx.patientReturn.count({ where: { patientProtocolId, status: { in: OPEN_RETURN } } });
  if (open === 0) {
    await tx.patientProtocol.updateMany({ where: { id: patientProtocolId, status: "ACTIVE" }, data: { status: "COMPLETED" } });
  }
}

/** Após uma etapa realizada, recalcula as etapas encadeadas ainda pendentes. */
async function recalculateFollowingSteps(
  tx: Prisma.TransactionClient,
  patientReturn: { patientProtocolId: string | null; protocolStepId: string | null },
  completedOnKey: string,
  clock: CareClock,
) {
  if (!patientReturn.patientProtocolId || !patientReturn.protocolStepId) return;
  const returns = await tx.patientReturn.findMany({
    where: { patientProtocolId: patientReturn.patientProtocolId, protocolStepId: { not: null } },
    include: { protocolStep: true },
  });
  const steps = returns
    .filter((item) => item.protocolStep)
    .map((item) => ({
      id: item.protocolStep!.id,
      position: item.protocolStep!.position,
      offsetDays: item.protocolStep!.offsetDays,
      relativeTo: item.protocolStep!.relativeTo,
      dueKey: dbDateToKey(item.dueDate),
      adjustable: item.status === "PENDING",
      returnId: item.id,
    }));
  const changes = recomputeAfterCompletion(steps, patientReturn.protocolStepId, completedOnKey);
  const settings = clock.reminders ?? DEFAULT_REMINDER_SETTINGS;
  for (const step of steps) {
    const nextDue = changes.get(step.id);
    if (!nextDue) continue;
    const updated = await tx.patientReturn.update({ where: { id: step.returnId }, data: { dueDate: dateKeyToDbDate(nextDue) } });
    await scheduleReturnReminder(tx, updated, settings, { timeZone: clock.timeZone, now: nowOf(clock) });
  }
}

// ---------------------------------------------------------------------------
// Procedimentos realizados e retornos avulsos
// ---------------------------------------------------------------------------

export async function createProcedureRecord(
  db: DbClient,
  actor: Actor,
  patientId: string,
  input: ProcedureRecordInput,
  clock: CareClock,
) {
  assertPermission(actor, "patients:write");
  const now = nowOf(clock);
  const performedAt = performedAtFor(input.date, input.time, clock);
  if (input.date > todayKey(clock.timeZone, now) || performedAt.getTime() > now.getTime() + 60 * 60 * 1000) {
    throw new DomainError("A data do procedimento realizado não pode estar no futuro.", { fieldErrors: { date: ["Data no futuro."] } });
  }
  const procedure = await db.procedure.findUnique({ where: { id: input.procedureId }, select: { id: true, name: true, suggestedReturnDays: true } });
  if (!procedure) throw new DomainError("Procedimento inválido.");

  return db.$transaction(async (tx) => {
    const patient = await tx.patient.findUnique({ where: { id: patientId }, select: { id: true } });
    if (!patient) throw new NotFoundError("Paciente");
    const record = await tx.procedureRecord.create({
      data: {
        patientId,
        procedureId: procedure.id,
        professionalId: input.professionalId ?? null,
        performedAt,
        notes: input.notes ?? null,
      },
    });
    await recordAudit(tx, { ...auditContext(actor), action: "procedure_record.create", entityType: "procedure_record", entityId: record.id });

    if (input.createReturn && procedure.suggestedReturnDays) {
      const created = await tx.patientReturn.create({
        data: {
          patientId,
          procedureId: procedure.id,
          sourceRecordId: record.id,
          kind: "REVIEW",
          title: `Retorno de ${procedure.name}`,
          dueDate: dateKeyToDbDate(addDaysToKey(input.date, procedure.suggestedReturnDays)),
        },
      });
      await scheduleReturnReminder(tx, created, clock.reminders ?? DEFAULT_REMINDER_SETTINGS, { timeZone: clock.timeZone, now });
      await recordAudit(tx, { ...auditContext(actor), action: "return.create", entityType: "patient_return", entityId: created.id });
    }
    return { id: record.id };
  });
}

export async function createReturn(db: DbClient, actor: Actor, patientId: string, input: ReturnCreateInput, clock: CareClock) {
  assertPermission(actor, "returns:write");
  const now = nowOf(clock);
  return db.$transaction(async (tx) => {
    const patient = await tx.patient.findUnique({ where: { id: patientId }, select: { id: true, isActive: true } });
    if (!patient) throw new NotFoundError("Paciente");
    if (!patient.isActive) throw new DomainError("Reative o paciente antes de programar retornos.");
    const created = await tx.patientReturn.create({
      data: {
        patientId,
        procedureId: input.procedureId ?? null,
        kind: input.kind,
        title: input.title,
        dueDate: dateKeyToDbDate(input.dueDate),
        notes: input.notes ?? null,
      },
    });
    await scheduleReturnReminder(tx, created, clock.reminders ?? DEFAULT_REMINDER_SETTINGS, { timeZone: clock.timeZone, now });
    await recordAudit(tx, { ...auditContext(actor), action: "return.create", entityType: "patient_return", entityId: created.id });
    return { id: created.id };
  });
}

/** Nova data ou observação. Um retorno "não compareceu" volta a ficar pendente com a nova data. */
export async function updateReturn(db: DbClient, actor: Actor, returnId: string, input: ReturnUpdateInput, clock: CareClock) {
  assertPermission(actor, "returns:write");
  const now = nowOf(clock);
  return db.$transaction(async (tx) => {
    const current = await tx.patientReturn.findUnique({ where: { id: returnId } });
    if (!current) throw new NotFoundError("Retorno");
    if (current.status !== "PENDING" && current.status !== "MISSED") {
      throw new DomainError("Só retornos pendentes ou não comparecidos podem receber nova data. Para retornos agendados, remarque o agendamento.");
    }
    const updated = await tx.patientReturn.update({
      where: { id: returnId },
      data: {
        dueDate: dateKeyToDbDate(input.dueDate),
        notes: input.notes ?? current.notes,
        status: "PENDING",
        resolvedAt: null,
        appointmentId: current.status === "MISSED" ? null : current.appointmentId,
      },
    });
    await scheduleReturnReminder(tx, updated, clock.reminders ?? DEFAULT_REMINDER_SETTINGS, { timeZone: clock.timeZone, now });
    await recordAudit(tx, {
      ...auditContext(actor),
      action: "return.update",
      entityType: "patient_return",
      entityId: returnId,
      metadata: { from: current.status, to: "PENDING" },
    });
  });
}

async function resolveReturnInTx(
  tx: Prisma.TransactionClient,
  actor: Actor,
  returnId: string,
  status: "COMPLETED" | "MISSED" | "CANCELLED",
  dateKey: string,
  clock: CareClock,
) {
  const now = nowOf(clock);
  const current = await tx.patientReturn.findUnique({ where: { id: returnId } });
  if (!current) throw new NotFoundError("Retorno");
  if (current.status === status) return current;
  if (current.status === "COMPLETED" || current.status === "CANCELLED") {
    throw new DomainError("Este retorno já foi resolvido.");
  }
  const updated = await tx.patientReturn.update({
    where: { id: returnId },
    data: {
      status,
      resolvedAt: status === "COMPLETED" ? zonedDateTime(dateKey, "12:00", clock.timeZone) : now,
    },
  });
  await cancelPendingReminders(tx, { returnId }, "Retorno resolvido.", now);
  if (status === "COMPLETED") await recalculateFollowingSteps(tx, current, dateKey, clock);
  await completeProtocolIfDone(tx, current.patientProtocolId);
  await recordAudit(tx, {
    ...auditContext(actor),
    action: "return.status.change",
    entityType: "patient_return",
    entityId: returnId,
    metadata: { from: current.status, to: status },
  });
  return updated;
}

/** Registra se o paciente compareceu, não compareceu ou se o retorno foi cancelado. */
export async function resolveReturn(db: DbClient, actor: Actor, returnId: string, input: ReturnResolveInput, clock: CareClock) {
  assertPermission(actor, "returns:write");
  const today = todayKey(clock.timeZone, nowOf(clock));
  const dateKey = input.date ?? today;
  if (dateKey > today) throw new DomainError("A data de comparecimento não pode estar no futuro.");
  return db.$transaction(async (tx) => {
    const current = await tx.patientReturn.findUnique({ where: { id: returnId }, select: { status: true } });
    if (current?.status === "SCHEDULED") {
      // O comparecimento de um retorno agendado é registrado pelo agendamento,
      // para agenda e retorno não ficarem divergentes.
      throw new DomainError("Este retorno está agendado: registre o comparecimento, a falta ou o cancelamento pelo agendamento na agenda.", {
        code: "return_is_scheduled",
      });
    }
    return resolveReturnInTx(tx, actor, returnId, input.status, dateKey, clock);
  });
}

// ---------------------------------------------------------------------------
// Integração com a agenda
// ---------------------------------------------------------------------------

/** Vincula um retorno a um agendamento recém-criado (retorno passa a "agendado"). */
export async function linkReturnToAppointment(
  tx: Prisma.TransactionClient,
  returnId: string,
  appointment: { id: string; patientId: string | null },
  now: Date,
) {
  const patientReturn = await tx.patientReturn.findUnique({ where: { id: returnId } });
  if (!patientReturn || patientReturn.patientId !== appointment.patientId) {
    throw new DomainError("O retorno selecionado não pertence a este paciente.");
  }
  if (patientReturn.status !== "PENDING" && patientReturn.status !== "MISSED") {
    throw new DomainError("Este retorno já está agendado ou resolvido.");
  }
  await tx.patientReturn.update({ where: { id: returnId }, data: { status: "SCHEDULED", appointmentId: appointment.id, resolvedAt: null } });
  // O lembrete do agendamento substitui o lembrete do retorno.
  await cancelPendingReminders(tx, { returnId }, "Retorno agendado.", now);
}

/** Reflexo das mudanças de status do agendamento no retorno vinculado. */
export async function onAppointmentStatusChanged(
  tx: Prisma.TransactionClient,
  actor: Actor,
  appointment: { id: string; startsAt: Date },
  status: "COMPLETED" | "CANCELLED" | "NO_SHOW",
  clock: CareClock,
) {
  const patientReturn = await tx.patientReturn.findUnique({ where: { appointmentId: appointment.id } });
  if (!patientReturn || patientReturn.status !== "SCHEDULED") return;
  const now = nowOf(clock);

  if (status === "COMPLETED") {
    await resolveReturnInTx(tx, actor, patientReturn.id, "COMPLETED", dateKeyOf(appointment.startsAt, clock.timeZone), clock);
    return;
  }
  if (status === "NO_SHOW") {
    await resolveReturnInTx(tx, actor, patientReturn.id, "MISSED", dateKeyOf(appointment.startsAt, clock.timeZone), clock);
    return;
  }
  // Agendamento cancelado: o retorno volta a ficar pendente para novo contato.
  const reopened = await tx.patientReturn.update({
    where: { id: patientReturn.id },
    data: { status: "PENDING", appointmentId: null },
  });
  await scheduleReturnReminder(tx, reopened, clock.reminders ?? DEFAULT_REMINDER_SETTINGS, { timeZone: clock.timeZone, now });
}
