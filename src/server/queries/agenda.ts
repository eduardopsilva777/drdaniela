import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import type { AppointmentStatus } from "@/generated/prisma/enums";
import { phoneDigits } from "@/lib/phone";
import { requirePermission } from "@/server/auth/dal";
import { getDb } from "@/server/db";

/**
 * Consultas da agenda. Cada função exige a permissão no servidor — a checagem
 * fica junto ao dado, não apenas na página que o exibe.
 */

/** Leads que ainda podem receber agendamento (avaliação antes da conversão). */
export async function searchSchedulableLeads(query: string, limit = 8) {
  await requirePermission("leads:read");
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];
  const digits = phoneDigits(trimmed);
  return getDb().lead.findMany({
    where: {
      status: { in: ["NEW", "IN_PROGRESS", "SCHEDULED"] },
      patientId: null,
      OR: [
        { name: { contains: trimmed, mode: "insensitive" } },
        ...(digits.length >= 3 ? [{ phone: { contains: digits } }] : []),
      ],
    },
    orderBy: { name: "asc" },
    take: limit,
    select: { id: true, name: true, phone: true },
  });
}

const AGENDA_SELECT = {
  id: true,
  startsAt: true,
  endsAt: true,
  status: true,
  notes: true,
  cancellationReason: true,
  rescheduledFromId: true,
  professional: { select: { id: true, name: true } },
  procedure: { select: { id: true, name: true, color: true } },
  patient: { select: { id: true, fullName: true, preferredName: true, phone: true } },
  lead: { select: { id: true, name: true, phone: true } },
  rescheduledTo: { select: { id: true, startsAt: true } },
  return: { select: { id: true, title: true } },
} as const satisfies Prisma.AppointmentSelect;

type AgendaRow = Prisma.AppointmentGetPayload<{ select: typeof AGENDA_SELECT }>;

export interface AgendaAppointment {
  id: string;
  startsAt: Date;
  endsAt: Date;
  status: AppointmentStatus;
  notes: string | null;
  cancellationReason: string | null;
  rescheduledFromId: string | null;
  rescheduledTo: { id: string; startsAt: Date } | null;
  subject: { kind: "patient" | "lead"; id: string; name: string; phone: string };
  professional: { id: string; name: string };
  procedure: { id: string; name: string; color: string | null } | null;
  linkedReturn: { id: string; title: string } | null;
}

function toAgendaAppointment(row: AgendaRow): AgendaAppointment {
  const subject = row.patient
    ? {
        kind: "patient" as const,
        id: row.patient.id,
        name: row.patient.preferredName ? `${row.patient.fullName} (${row.patient.preferredName})` : row.patient.fullName,
        phone: row.patient.phone,
      }
    : { kind: "lead" as const, id: row.lead!.id, name: row.lead!.name, phone: row.lead!.phone };
  return {
    id: row.id,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    status: row.status,
    notes: row.notes,
    cancellationReason: row.cancellationReason,
    rescheduledFromId: row.rescheduledFromId,
    rescheduledTo: row.rescheduledTo,
    subject,
    professional: row.professional,
    procedure: row.procedure,
    linkedReturn: row.return,
  };
}

export interface AgendaQuery {
  start: Date;
  end: Date;
  professionalId?: string;
  /** Sem status definido, cancelados ficam de fora (liberaram o horário). */
  status?: AppointmentStatus;
}

/** Agendamentos que começam no intervalo [start, end), em ordem de horário. */
export async function getAgendaAppointments(query: AgendaQuery): Promise<AgendaAppointment[]> {
  await requirePermission("appointments:read");
  const rows = await getDb().appointment.findMany({
    where: {
      startsAt: { gte: query.start, lt: query.end },
      ...(query.professionalId ? { professionalId: query.professionalId } : {}),
      status: query.status ?? { not: "CANCELLED" },
    },
    orderBy: [{ startsAt: "asc" }, { endsAt: "asc" }],
    take: 1000,
    select: AGENDA_SELECT,
  });
  return rows.map(toAgendaAppointment);
}

/** Retornos de um paciente que ainda podem ser vinculados a um novo agendamento. */
export async function getSchedulableReturns(patientId: string) {
  await requirePermission("returns:read");
  return getDb().patientReturn.findMany({
    where: { patientId, status: { in: ["PENDING", "MISSED"] } },
    orderBy: { dueDate: "asc" },
    take: 20,
    select: { id: true, title: true, dueDate: true, procedureId: true },
  });
}
