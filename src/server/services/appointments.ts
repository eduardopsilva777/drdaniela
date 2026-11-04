import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import type { AppointmentStatus } from "@/generated/prisma/enums";
import { dateKeyOf, diffInDays, formatKeyDayMonth, timeOf, todayKey, zonedDateTime } from "@/lib/datetime";
import { APPOINTMENT_STATUS_LABELS } from "@/lib/labels";
import type {
  AppointmentCreateInput,
  AppointmentDetailsInput,
  AppointmentRescheduleInput,
  AppointmentStatusInput,
} from "@/lib/validation/appointments";
import { recordAudit } from "@/server/audit";
import type { DbClient, DbExecutor } from "@/server/db/prisma";
import { DomainError, isConstraintViolation, NotFoundError, retryOnWriteConflict } from "@/server/errors";

import { linkReturnToAppointment, onAppointmentStatusChanged, type CareClock } from "./care-plan";
import { assertPermission, auditContext, type Actor } from "./context";
import { markLeadScheduled, revertLeadIfUnscheduled } from "./leads";
import { cancelPendingReminders, DEFAULT_REMINDER_SETTINGS, scheduleAppointmentReminder } from "./reminders";

/**
 * Agenda. Regras:
 * - Um profissional não tem dois atendimentos ativos sobrepostos (verificado
 *   aqui com mensagem amigável e garantido no banco por EXCLUDE USING gist).
 * - "Não compareceu" e "Concluído" só depois do horário de início.
 * - Cancelado e não comparecido são finais; para remarcar, cria-se um novo
 *   agendamento ligado ao original (o histórico é preservado).
 * - Reagendar (mudar horário) mantém o registro e grava o horário anterior.
 */

/** Status que ocupam o horário (o mesmo critério da restrição no banco). */
const BLOCKING_STATUSES: AppointmentStatus[] = ["SCHEDULED", "CONFIRMED", "COMPLETED"];

const ALLOWED_TRANSITIONS: Record<AppointmentStatus, AppointmentStatus[]> = {
  SCHEDULED: ["CONFIRMED", "COMPLETED", "CANCELLED", "NO_SHOW"],
  CONFIRMED: ["SCHEDULED", "COMPLETED", "CANCELLED", "NO_SHOW"],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
};

export function canTransition(from: AppointmentStatus, to: AppointmentStatus): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/** Agendamentos podem ser feitos com até 2 anos de antecedência. */
export const MAX_DAYS_AHEAD = 730;

/**
 * Converte data/hora local em instantes e valida a janela permitida:
 * não agenda em dias passados (hoje é aceito, para registrar encaixes),
 * nem a mais de 2 anos, e o atendimento termina no mesmo dia.
 */
function timesFrom(
  input: { date: string; startTime: string; durationMinutes: number },
  clock: CareClock,
) {
  const startsAt = zonedDateTime(input.date, input.startTime, clock.timeZone);
  const endsAt = new Date(startsAt.getTime() + input.durationMinutes * 60 * 1000);
  const today = todayKey(clock.timeZone, clock.now ?? new Date());

  if (input.date < today) {
    const message = "Não é possível agendar em uma data que já passou.";
    throw new DomainError(message, { code: "date_in_past", fieldErrors: { date: [message] } });
  }
  if (diffInDays(today, input.date) > MAX_DAYS_AHEAD) {
    const message = "Data muito distante: agende com no máximo 2 anos de antecedência.";
    throw new DomainError(message, { code: "date_too_far", fieldErrors: { date: [message] } });
  }
  if (dateKeyOf(new Date(endsAt.getTime() - 1), clock.timeZone) !== input.date) {
    const message = "O atendimento precisa terminar no mesmo dia. Reduza a duração ou antecipe o início.";
    throw new DomainError(message, { code: "crosses_midnight", fieldErrors: { durationMinutes: [message] } });
  }
  return { startsAt, endsAt };
}

async function findConflict(
  db: DbExecutor,
  professionalId: string,
  startsAt: Date,
  endsAt: Date,
  excludeId?: string,
) {
  return db.appointment.findFirst({
    where: {
      professionalId,
      status: { in: BLOCKING_STATUSES },
      startsAt: { lt: endsAt },
      endsAt: { gt: startsAt },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { startsAt: true, endsAt: true },
  });
}

/**
 * Serializa as gravações na agenda de uma profissional dentro da transação
 * (advisory lock do PostgreSQL, liberado no commit/rollback). Assim a checagem
 * de conflito feita em seguida enxerga os horários gravados por quem chegou
 * antes, e inserções simultâneas não entram em deadlock na restrição EXCLUDE.
 */
async function lockProfessionalSchedule(tx: DbExecutor, professionalId: string) {
  await tx.$queryRaw`SELECT 1 AS "locked" FROM (SELECT pg_advisory_xact_lock(hashtext(${`agenda:${professionalId}`}))) AS "lock"`;
}

function conflictError(conflict: { startsAt: Date; endsAt: Date } | null, timeZone: string): DomainError {
  const message = conflict
    ? `Conflito de horário: esta agenda já tem atendimento das ${timeOf(conflict.startsAt, timeZone)} às ${timeOf(conflict.endsAt, timeZone)} em ${formatKeyDayMonth(dateKeyOf(conflict.startsAt, timeZone))}.`
    : "Conflito de horário com outro atendimento desta agenda.";
  return new DomainError(message, { code: "schedule_conflict", fieldErrors: { startTime: [message] } });
}

function concurrentChangeError(): DomainError {
  return new DomainError("Este agendamento acabou de ser alterado por outra pessoa. Atualize a agenda.", {
    code: "concurrent_update",
  });
}

async function assertProfessional(db: DbExecutor, professionalId: string) {
  const professional = await db.user.findFirst({
    where: { id: professionalId, isActive: true, role: { in: ["PROFESSIONAL", "ADMIN"] } },
    select: { id: true },
  });
  if (!professional) {
    throw new DomainError("Profissional inválido.", { fieldErrors: { professionalId: ["Selecione um profissional ativo."] } });
  }
}

async function assertProcedure(db: DbExecutor, procedureId: string | undefined) {
  if (!procedureId) return;
  const procedure = await db.procedure.findUnique({ where: { id: procedureId }, select: { id: true } });
  if (!procedure) throw new DomainError("Procedimento inválido.", { fieldErrors: { procedureId: ["Selecione um procedimento válido."] } });
}

function settingsOf(clock: CareClock) {
  return clock.reminders ?? DEFAULT_REMINDER_SETTINGS;
}

export async function createAppointment(db: DbClient, actor: Actor, input: AppointmentCreateInput, clock: CareClock) {
  assertPermission(actor, "appointments:write");
  const now = clock.now ?? new Date();
  const { startsAt, endsAt } = timesFrom(input, clock);

  await assertProfessional(db, input.professionalId);
  await assertProcedure(db, input.procedureId);

  let patientId: string | null = null;
  let leadId: string | null = null;
  if (input.subject === "patient") {
    const patient = await db.patient.findUnique({ where: { id: input.patientId! }, select: { id: true, isActive: true } });
    if (!patient) throw new NotFoundError("Paciente");
    if (!patient.isActive) throw new DomainError("Paciente inativo. Reative o cadastro para agendar.");
    patientId = patient.id;
  } else {
    const lead = await db.lead.findUnique({ where: { id: input.leadId! }, select: { id: true, status: true, patientId: true } });
    if (!lead) throw new NotFoundError("Lead");
    if (lead.patientId) {
      // Lead já convertido: o agendamento é do paciente.
      patientId = lead.patientId;
    } else if (lead.status === "LOST") {
      throw new DomainError("Este lead está marcado como perdido. Mude a etapa antes de agendar.");
    } else {
      leadId = lead.id;
    }
  }

  if (input.rescheduledFromId) {
    const original = await db.appointment.findUnique({
      where: { id: input.rescheduledFromId },
      select: { status: true, rescheduledTo: { select: { id: true } } },
    });
    if (!original || (original.status !== "CANCELLED" && original.status !== "NO_SHOW")) {
      throw new DomainError("Só agendamentos cancelados ou sem comparecimento podem ser remarcados assim.");
    }
    if (original.rescheduledTo) throw new DomainError("Este agendamento já foi remarcado.");
  }

  return retryOnWriteConflict(async () => {
    try {
      return await db.$transaction(async (tx) => {
        await lockProfessionalSchedule(tx, input.professionalId);
        const conflict = await findConflict(tx, input.professionalId, startsAt, endsAt);
        if (conflict) throw conflictError(conflict, clock.timeZone);

        const appointment = await tx.appointment.create({
          data: {
            patientId,
            leadId,
            professionalId: input.professionalId,
            procedureId: input.procedureId ?? null,
            startsAt,
            endsAt,
            notes: input.notes ?? null,
            rescheduledFromId: input.rescheduledFromId ?? null,
          },
        });
        await tx.appointmentEvent.create({
          data: {
            appointmentId: appointment.id,
            type: "CREATED",
            toStatus: "SCHEDULED",
            newStartsAt: startsAt,
            newEndsAt: endsAt,
            reason: input.rescheduledFromId ? "Remarcação de agendamento anterior." : null,
            actorId: actor.id,
          },
        });

        if (leadId) {
          await markLeadScheduled(tx, actor, leadId, now);
          await tx.interaction.create({
            data: {
              leadId,
              type: "SYSTEM",
              content: `Agendamento criado para ${formatKeyDayMonth(input.date)} às ${input.startTime}.`,
              authorId: actor.id,
              occurredAt: now,
            },
          });
        }
        if (input.returnId) await linkReturnToAppointment(tx, input.returnId, appointment, now);
        await scheduleAppointmentReminder(tx, appointment, settingsOf(clock), now);

        await recordAudit(tx, {
          ...auditContext(actor),
          action: "appointment.create",
          entityType: "appointment",
          entityId: appointment.id,
        });
        return appointment;
      });
    } catch (error) {
      if (isConstraintViolation(error, "appointments_no_overlap")) {
        throw conflictError(await findConflict(db, input.professionalId, startsAt, endsAt), clock.timeZone);
      }
      throw error;
    }
  });
}

export async function updateAppointmentDetails(
  db: DbClient,
  actor: Actor,
  appointmentId: string,
  input: AppointmentDetailsInput,
  clock: CareClock,
) {
  assertPermission(actor, "appointments:write");
  const current = await db.appointment.findUnique({ where: { id: appointmentId } });
  if (!current) throw new NotFoundError("Agendamento");
  if (current.status === "CANCELLED" || current.status === "NO_SHOW") {
    throw new DomainError("Agendamentos cancelados ou sem comparecimento não podem ser alterados.");
  }
  await assertProfessional(db, input.professionalId);
  await assertProcedure(db, input.procedureId);
  return retryOnWriteConflict(async () => {
    try {
      return await db.$transaction(async (tx) => {
        if (input.professionalId !== current.professionalId) {
          await lockProfessionalSchedule(tx, input.professionalId);
          const conflict = await findConflict(tx, input.professionalId, current.startsAt, current.endsAt, appointmentId);
          if (conflict) throw conflictError(conflict, clock.timeZone);
        }
        // Condicional: se outra pessoa cancelou ou remarcou no meio do caminho, nada é sobrescrito.
        const updated = await tx.appointment.updateMany({
          where: { id: appointmentId, status: current.status, startsAt: current.startsAt, endsAt: current.endsAt },
          data: { professionalId: input.professionalId, procedureId: input.procedureId ?? null, notes: input.notes ?? null },
        });
        if (updated.count === 0) throw concurrentChangeError();
        const appointment = await tx.appointment.findUniqueOrThrow({ where: { id: appointmentId } });
        await tx.appointmentEvent.create({ data: { appointmentId, type: "UPDATED", actorId: actor.id } });
        await recordAudit(tx, { ...auditContext(actor), action: "appointment.update", entityType: "appointment", entityId: appointmentId });
        return appointment;
      });
    } catch (error) {
      if (isConstraintViolation(error, "appointments_no_overlap")) throw conflictError(null, clock.timeZone);
      throw error;
    }
  });
}

export async function rescheduleAppointment(
  db: DbClient,
  actor: Actor,
  appointmentId: string,
  input: AppointmentRescheduleInput,
  clock: CareClock,
) {
  assertPermission(actor, "appointments:write");
  const now = clock.now ?? new Date();
  const current = await db.appointment.findUnique({ where: { id: appointmentId } });
  if (!current) throw new NotFoundError("Agendamento");
  if (current.status !== "SCHEDULED" && current.status !== "CONFIRMED") {
    throw new DomainError("Só agendamentos marcados ou confirmados podem ser reagendados. Para cancelados ou sem comparecimento, use “Remarcar”.");
  }
  const { startsAt, endsAt } = timesFrom(input, clock);
  if (startsAt.getTime() === current.startsAt.getTime() && endsAt.getTime() === current.endsAt.getTime()) {
    throw new DomainError("Escolha um horário diferente do atual.");
  }
  return retryOnWriteConflict(async () => {
    try {
      return await db.$transaction(async (tx) => {
        await lockProfessionalSchedule(tx, current.professionalId);
        const conflict = await findConflict(tx, current.professionalId, startsAt, endsAt, appointmentId);
        if (conflict) throw conflictError(conflict, clock.timeZone);

        // Condicional: um cancelamento (ou outra remarcação) feito no meio do caminho
        // não é desfeito — o agendamento cancelado não volta a ficar marcado.
        const updated = await tx.appointment.updateMany({
          where: { id: appointmentId, status: current.status, startsAt: current.startsAt, endsAt: current.endsAt },
          // Novo horário precisa de nova confirmação do paciente.
          data: { startsAt, endsAt, status: "SCHEDULED", confirmedAt: null },
        });
        if (updated.count === 0) throw concurrentChangeError();
        const appointment = await tx.appointment.findUniqueOrThrow({ where: { id: appointmentId } });
        await tx.appointmentEvent.create({
          data: {
            appointmentId,
            type: "RESCHEDULED",
            fromStatus: current.status,
            toStatus: "SCHEDULED",
            previousStartsAt: current.startsAt,
            previousEndsAt: current.endsAt,
            newStartsAt: startsAt,
            newEndsAt: endsAt,
            reason: input.reason ?? null,
            actorId: actor.id,
          },
        });
        await scheduleAppointmentReminder(tx, appointment, settingsOf(clock), now);
        await recordAudit(tx, { ...auditContext(actor), action: "appointment.reschedule", entityType: "appointment", entityId: appointmentId });
        return appointment;
      });
    } catch (error) {
      if (isConstraintViolation(error, "appointments_no_overlap")) {
        throw conflictError(await findConflict(db, current.professionalId, startsAt, endsAt, appointmentId), clock.timeZone);
      }
      throw error;
    }
  });
}

export async function changeAppointmentStatus(
  db: DbClient,
  actor: Actor,
  appointmentId: string,
  input: AppointmentStatusInput,
  clock: CareClock,
) {
  assertPermission(actor, "appointments:write");
  const now = clock.now ?? new Date();

  try {
    return await retryOnWriteConflict(() => db.$transaction(async (tx) => {
      const current = await tx.appointment.findUnique({ where: { id: appointmentId } });
      if (!current) throw new NotFoundError("Agendamento");
      const target = input.status;
      if (current.status === target) return current;
      if (!canTransition(current.status, target)) {
        throw new DomainError(
          `Não é possível mudar de “${APPOINTMENT_STATUS_LABELS[current.status]}” para “${APPOINTMENT_STATUS_LABELS[target]}”.`,
          { code: "invalid_transition" },
        );
      }
      if ((target === "NO_SHOW" || target === "COMPLETED") && current.startsAt.getTime() > now.getTime() + 15 * 60 * 1000) {
        throw new DomainError("Só é possível registrar comparecimento depois do horário de início.");
      }

      const data: Prisma.AppointmentUncheckedUpdateInput = { status: target };
      if (target === "CONFIRMED") data.confirmedAt = now;
      if (target === "SCHEDULED") data.confirmedAt = null;
      if (target === "COMPLETED") data.completedAt = now;
      if (target === "CANCELLED") {
        data.cancelledAt = now;
        data.cancellationReason = input.reason ?? null;
      }
      if (target === "NO_SHOW") data.noShowAt = now;

      // Atualização condicional: protege contra mudanças simultâneas.
      const updated = await tx.appointment.updateMany({ where: { id: appointmentId, status: current.status }, data });
      if (updated.count === 0) throw concurrentChangeError();

      await tx.appointmentEvent.create({
        data: {
          appointmentId,
          type: "STATUS_CHANGED",
          fromStatus: current.status,
          toStatus: target,
          reason: input.reason ?? null,
          actorId: actor.id,
        },
      });

      if (target === "CANCELLED" || target === "NO_SHOW" || target === "COMPLETED") {
        await cancelPendingReminders(tx, { appointmentId }, `Agendamento ${APPOINTMENT_STATUS_LABELS[target].toLowerCase()}.`, now);
        await onAppointmentStatusChanged(tx, actor, current, target, clock);
      }
      // Lead sem outro horário ativo deixa de estar "Agendado" no funil.
      if (current.leadId && !current.patientId && (target === "CANCELLED" || target === "NO_SHOW")) {
        await revertLeadIfUnscheduled(tx, actor, current.leadId, now);
      }

      // Concluído com procedimento: entra no histórico do paciente.
      if (target === "COMPLETED" && current.patientId && current.procedureId) {
        const existing = await tx.procedureRecord.findUnique({ where: { appointmentId }, select: { id: true } });
        if (!existing) {
          const linkedReturn = await tx.patientReturn.findFirst({
            where: { appointmentId },
            select: { patientProtocolId: true, protocolStepId: true },
          });
          await tx.procedureRecord.create({
            data: {
              patientId: current.patientId,
              procedureId: current.procedureId,
              professionalId: current.professionalId,
              appointmentId,
              performedAt: current.startsAt,
              patientProtocolId: linkedReturn?.patientProtocolId ?? null,
              protocolStepId: linkedReturn?.protocolStepId ?? null,
            },
          });
        }
      }

      await recordAudit(tx, {
        ...auditContext(actor),
        action: "appointment.status.change",
        entityType: "appointment",
        entityId: appointmentId,
        metadata: { from: current.status, to: target },
      });
      return { ...current, status: target };
    }));
  } catch (error) {
    if (isConstraintViolation(error, "appointments_no_overlap")) throw conflictError(null, clock.timeZone);
    throw error;
  }
}

/** Histórico do agendamento (criação, remarcações, status). */
export async function getAppointmentHistory(db: DbClient, actor: Actor, appointmentId: string) {
  assertPermission(actor, "appointments:read");
  return db.appointmentEvent.findMany({
    where: { appointmentId },
    orderBy: { createdAt: "asc" },
    include: { actor: { select: { name: true } } },
  });
}
