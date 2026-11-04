import { z } from "zod";

import { AppointmentStatus } from "@/generated/prisma/enums";
import { isDateKey } from "@/lib/datetime";

import {
  dateKeySchema,
  firstQueryValue,
  intSchema,
  optionalText,
  optionalUuidSchema,
  timeSchema,
  uuidSchema,
} from "./common";

export const appointmentCreateSchema = z
  .object({
    subject: z.enum(["patient", "lead"]),
    patientId: optionalUuidSchema,
    leadId: optionalUuidSchema,
    professionalId: z.uuid({ error: "Selecione o profissional." }),
    procedureId: optionalUuidSchema,
    date: dateKeySchema,
    startTime: timeSchema,
    durationMinutes: intSchema("a duração", 5, 720),
    notes: optionalText("as observações", 500),
    /** Retorno programado que este agendamento atende. */
    returnId: optionalUuidSchema,
    /** Agendamento cancelado/ausente que está sendo remarcado. */
    rescheduledFromId: optionalUuidSchema,
  })
  .superRefine((value, context) => {
    if (value.subject === "patient" && !value.patientId) {
      context.addIssue({ code: "custom", path: ["patientId"], message: "Selecione o paciente." });
    }
    if (value.subject === "lead" && !value.leadId) {
      context.addIssue({ code: "custom", path: ["leadId"], message: "Selecione o lead." });
    }
  });

export type AppointmentCreateInput = z.output<typeof appointmentCreateSchema>;

export const appointmentDetailsSchema = z.object({
  professionalId: uuidSchema,
  procedureId: optionalUuidSchema,
  notes: optionalText("as observações", 500),
});

export type AppointmentDetailsInput = z.output<typeof appointmentDetailsSchema>;

export const appointmentRescheduleSchema = z.object({
  date: dateKeySchema,
  startTime: timeSchema,
  durationMinutes: intSchema("a duração", 5, 720),
  reason: optionalText("o motivo", 300),
});

export type AppointmentRescheduleInput = z.output<typeof appointmentRescheduleSchema>;

export const appointmentStatusSchema = z
  .object({
    status: z.enum(AppointmentStatus),
    reason: optionalText("o motivo", 200),
  })
  .superRefine((value, context) => {
    if (value.status === "CANCELLED" && !value.reason) {
      context.addIssue({ code: "custom", path: ["reason"], message: "Informe o motivo do cancelamento." });
    }
  });

export type AppointmentStatusInput = z.output<typeof appointmentStatusSchema>;


export const AGENDA_VIEWS = ["dia", "semana", "mes"] as const;

export const agendaFiltersSchema = z.object({
  data: z.preprocess(firstQueryValue, z.string().refine(isDateKey).optional()).catch(undefined),
  visao: z.preprocess(firstQueryValue, z.enum(AGENDA_VIEWS)).catch("semana"),
  profissional: z.preprocess(firstQueryValue, z.uuid().optional()).catch(undefined),
  status: z.preprocess(firstQueryValue, z.enum(AppointmentStatus).optional()).catch(undefined),
});

export type AgendaFilters = z.output<typeof agendaFiltersSchema>;
