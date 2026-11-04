import { z } from "zod";

/**
 * Estado do fluxo do assistente em uma conversa (coluna `assistant_state`).
 * Guarda só o necessário para continuar o atendimento: etapa atual, nome e
 * interesse informados, horários oferecidos. Nunca contém dados clínicos.
 * Conteúdo inválido (ex.: versão antiga) volta ao estado inicial.
 */

export const storedSlotSchema = z.object({
  startsAt: z.string(),
  professionalId: z.uuid(),
  durationMinutes: z.number().int().positive(),
  dateKey: z.string(),
  time: z.string(),
  label: z.string().max(80),
  /** Horário calculado para remarcar este agendamento (nulo: horário para um agendamento novo). */
  forAppointmentId: z.uuid().nullable().default(null),
});

export type StoredSlot = z.output<typeof storedSlotSchema>;

export const appointmentOptionSchema = z.object({
  id: z.uuid(),
  label: z.string().max(160),
  dateLabel: z.string().max(80),
  time: z.string().max(5),
  professionalId: z.uuid(),
  durationMinutes: z.number().int().positive(),
});

export type AppointmentOption = z.output<typeof appointmentOptionSchema>;

/**
 * Ação importante proposta pela IA generativa e ainda NÃO executada: só vira
 * agendamento/remarcação/cancelamento quando o contato confirma explicitamente
 * numa mensagem posterior (o servidor confere) — nunca na mesma mensagem.
 */
export const pendingActionSchema = z.object({
  type: z.enum(["book", "reschedule", "cancel"]),
  slot: storedSlotSchema.nullable(),
  appointment: appointmentOptionSchema.nullable(),
  /** Retorno previsto que o agendamento atende (só pacientes). */
  returnId: z.uuid().nullable(),
  procedureName: z.string().max(120).nullable(),
  proposedAt: z.string(),
  /** Mensagem do contato que estava sendo respondida quando a ação foi proposta. */
  proposedForMessageId: z.uuid().nullable(),
});

export type PendingAction = z.output<typeof pendingActionSchema>;

export const ASSISTANT_STEPS = [
  "ask_name",
  "ask_question",
  "ask_next_step",
  "ask_preference",
  "choose_slot",
  "confirm_slot",
  "choose_appointment",
  "confirm_cancel",
  "confirm_handoff",
  "ask_consent",
  "clarify_cancel",
  "confirm_reschedule_existing",
  "confirm_new_booking",
] as const;

export type AssistantStep = (typeof ASSISTANT_STEPS)[number];

export const assistantStateSchema = z.object({
  v: z.literal(1),
  flow: z.enum(["idle", "booking", "rescheduling", "cancelling"]).default("idle"),
  step: z.enum(ASSISTANT_STEPS).nullable().default(null),
  name: z.string().max(60).nullable().default(null),
  interest: z.string().max(200).nullable().default(null),
  procedureId: z.uuid().nullable().default(null),
  answers: z.record(z.string(), z.string().max(200)).default({}),
  questionIndex: z.number().int().min(0).max(20).default(0),
  bookingProcedureName: z.string().max(120).nullable().default(null),
  offeredSlots: z.array(storedSlotSchema).max(6).default([]),
  selectedSlot: storedSlotSchema.nullable().default(null),
  appointmentOptions: z.array(appointmentOptionSchema).max(6).default([]),
  target: appointmentOptionSchema.nullable().default(null),
  pendingAction: pendingActionSchema.nullable().default(null),
  greeted: z.boolean().default(false),
  qualified: z.boolean().default(false),
  leadRegistered: z.boolean().default(false),
  nextStepAsked: z.boolean().default(false),
  consentAsked: z.boolean().default(false),
  unknownCount: z.number().int().min(0).max(20).default(0),
  updatedAt: z.string().nullable().default(null),
});

export type AssistantState = z.output<typeof assistantStateSchema>;

export function initialAssistantState(): AssistantState {
  return assistantStateSchema.parse({ v: 1 });
}

/** Limpa a etapa em andamento (horários oferecidos, confirmações), mantendo o que o contato já informou. */
export function clearFlow(state: AssistantState): AssistantState {
  return {
    ...state,
    flow: "idle",
    step: null,
    offeredSlots: [],
    selectedSlot: null,
    appointmentOptions: [],
    target: null,
    pendingAction: null,
    bookingProcedureName: null,
  };
}

/**
 * Lê o estado gravado. Fluxos parados há mais de `ttlHours` recomeçam (horários
 * oferecidos ontem não podem ser confirmados hoje), mas o que o contato já
 * informou continua valendo.
 */
export function readAssistantState(stored: unknown, now: Date, ttlHours: number): AssistantState {
  const parsed = assistantStateSchema.safeParse(stored ?? { v: 1 });
  if (!parsed.success) return initialAssistantState();
  const state = parsed.data;
  if (state.updatedAt) {
    const age = now.getTime() - new Date(state.updatedAt).getTime();
    if (!Number.isFinite(age) || age > ttlHours * 60 * 60 * 1000) {
      return { ...clearFlow(state), unknownCount: 0 };
    }
  }
  return state;
}
