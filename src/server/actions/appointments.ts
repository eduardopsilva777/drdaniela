"use server";

import type { AppointmentEventType, AppointmentStatus } from "@/generated/prisma/enums";
import type { ActionResult } from "@/lib/action-result";
import { dbDateToKey, formatKeyDate } from "@/lib/datetime";
import { formatPhone } from "@/lib/phone";
import {
  appointmentCreateSchema,
  appointmentDetailsSchema,
  appointmentRescheduleSchema,
  appointmentStatusSchema,
} from "@/lib/validation/appointments";
import { formDataToObject, uuidSchema } from "@/lib/validation/common";
import { getSchedulableReturns, searchSchedulableLeads } from "@/server/queries/agenda";
import {
  changeAppointmentStatus,
  createAppointment,
  getAppointmentHistory,
  rescheduleAppointment,
  updateAppointmentDetails,
} from "@/server/services/appointments";

import { serviceClock } from "./clock";
import { runAction } from "./run-action";

export async function createAppointmentAction(formData: FormData): Promise<ActionResult<{ id: string }>> {
  return runAction(
    "appointments:write",
    async ({ db, actor }) => {
      const input = appointmentCreateSchema.parse(formDataToObject(formData));
      const appointment = await createAppointment(db, actor, input, serviceClock());
      return { id: appointment.id };
    },
    { message: "Agendamento criado." },
  );
}

export async function updateAppointmentDetailsAction(appointmentId: string, formData: FormData): Promise<ActionResult<null>> {
  return runAction(
    "appointments:write",
    async ({ db, actor }) => {
      const input = appointmentDetailsSchema.parse(formDataToObject(formData));
      await updateAppointmentDetails(db, actor, uuidSchema.parse(appointmentId), input, serviceClock());
      return null;
    },
    { message: "Agendamento atualizado." },
  );
}

export async function rescheduleAppointmentAction(appointmentId: string, formData: FormData): Promise<ActionResult<null>> {
  return runAction(
    "appointments:write",
    async ({ db, actor }) => {
      const input = appointmentRescheduleSchema.parse(formDataToObject(formData));
      await rescheduleAppointment(db, actor, uuidSchema.parse(appointmentId), input, serviceClock());
      return null;
    },
    { message: "Agendamento reagendado. O novo horário precisa ser confirmado." },
  );
}

export async function changeAppointmentStatusAction(
  appointmentId: string,
  input: { status: AppointmentStatus; reason?: string },
): Promise<ActionResult<null>> {
  return runAction(
    "appointments:write",
    async ({ db, actor }) => {
      const parsed = appointmentStatusSchema.parse(input);
      await changeAppointmentStatus(db, actor, uuidSchema.parse(appointmentId), parsed, serviceClock());
      return null;
    },
    { message: "Status do agendamento atualizado." },
  );
}

export interface AppointmentHistoryEntry {
  id: string;
  type: AppointmentEventType;
  fromStatus: AppointmentStatus | null;
  toStatus: AppointmentStatus | null;
  previousStartsAt: string | null;
  newStartsAt: string | null;
  reason: string | null;
  actorName: string | null;
  createdAt: string;
}

export async function getAppointmentHistoryAction(appointmentId: string): Promise<ActionResult<AppointmentHistoryEntry[]>> {
  return runAction(
    "appointments:read",
    async ({ db, actor }) => {
      const events = await getAppointmentHistory(db, actor, uuidSchema.parse(appointmentId));
      return events.map((event) => ({
        id: event.id,
        type: event.type,
        fromStatus: event.fromStatus,
        toStatus: event.toStatus,
        previousStartsAt: event.previousStartsAt?.toISOString() ?? null,
        newStartsAt: event.newStartsAt?.toISOString() ?? null,
        reason: event.reason,
        actorName: event.actor?.name ?? null,
        createdAt: event.createdAt.toISOString(),
      }));
    },
    { refresh: false },
  );
}

export interface SchedulableReturn {
  id: string;
  title: string;
  dueLabel: string;
  procedureId: string | null;
}

/** Retornos pendentes do paciente que o novo agendamento pode atender. */
export async function listReturnsForSchedulingAction(patientId: string): Promise<ActionResult<SchedulableReturn[]>> {
  return runAction(
    "returns:read",
    async () => {
      const rows = await getSchedulableReturns(uuidSchema.parse(patientId));
      return rows.map((row) => ({
        id: row.id,
        title: row.title,
        dueLabel: formatKeyDate(dbDateToKey(row.dueDate)),
        procedureId: row.procedureId,
      }));
    },
    { refresh: false },
  );
}

export async function searchLeadsForSchedulingAction(
  query: string,
): Promise<ActionResult<Array<{ id: string; fullName: string; phoneLabel: string }>>> {
  return runAction(
    "leads:read",
    async () => {
      const leads = await searchSchedulableLeads(String(query ?? "").slice(0, 80));
      return leads.map((lead) => ({ id: lead.id, fullName: lead.name, phoneLabel: formatPhone(lead.phone) }));
    },
    { refresh: false },
  );
}
