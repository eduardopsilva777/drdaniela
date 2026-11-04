import type { AppointmentStatus } from "@/generated/prisma/enums";

/**
 * Dados de agenda serializáveis (servidor → cliente). Rótulos de data/hora são
 * calculados no servidor, no fuso da clínica, para não divergirem na hidratação.
 */

export interface AgendaItem {
  id: string;
  dateKey: string;
  /** Minutos desde a meia-noite local. */
  startMinutes: number;
  endMinutes: number;
  durationMinutes: number;
  startTime: string;
  timeLabel: string;
  dateLabel: string;
  status: AppointmentStatus;
  subject: { kind: "patient" | "lead"; id: string; name: string; phoneLabel: string };
  professional: { id: string; name: string };
  procedure: { id: string; name: string } | null;
  color: string | null;
  notes: string | null;
  cancellationReason: string | null;
  rescheduledFromId: string | null;
  rescheduledTo: { id: string; label: string } | null;
  linkedReturnTitle: string | null;
  /** O horário de início já chegou (permite registrar comparecimento ou falta). */
  started: boolean;
}

export interface ProcedureChoice {
  value: string;
  label: string;
  durationMinutes: number;
}

export interface Choice {
  value: string;
  label: string;
}

export interface SubjectRef {
  kind: "patient" | "lead";
  id: string;
  name: string;
}
