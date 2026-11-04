import {
  addDaysToKey,
  formatKeyDayMonth,
  formatKeyWeekdayShort,
  todayKey,
  weekdayOf,
  zonedDateTime,
} from "@/lib/datetime";

import type { SchedulePreference } from "./text";

/**
 * Horários realmente disponíveis para o assistente oferecer (função pura).
 * Considera o horário de atendimento configurado pela clínica, a antecedência
 * mínima e os atendimentos que já ocupam a agenda de cada profissional. A
 * reserva em si é feita pelo serviço da agenda, que confere conflito de novo
 * com trava no banco — oferecer um horário nunca garante a vaga.
 */

export interface TimeRange {
  start: string;
  end: string;
}

export interface BusyInterval {
  professionalId: string;
  startsAt: Date;
  endsAt: Date;
}

export interface SlotRequest {
  now: Date;
  timeZone: string;
  /** Índice 0 = domingo … 6 = sábado. */
  weeklyHours: TimeRange[][];
  professionalIds: string[];
  durationMinutes: number;
  stepMinutes: number;
  minNoticeHours: number;
  maxDaysAhead: number;
  maxOptions: number;
  busy: BusyInterval[];
  preference?: SchedulePreference;
  /** No máximo N opções por dia, para variar as datas oferecidas. */
  maxPerDay?: number;
}

export interface AvailableSlot {
  startsAt: Date;
  endsAt: Date;
  professionalId: string;
  dateKey: string;
  time: string;
}

export interface SlotResult {
  slots: AvailableSlot[];
  /** false quando havia preferência e nada a atendia (as opções são alternativas). */
  matchedPreference: boolean;
}

function toMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number) as [number, number];
  return hours * 60 + minutes;
}

function toTime(totalMinutes: number): string {
  return `${String(Math.floor(totalMinutes / 60)).padStart(2, "0")}:${String(totalMinutes % 60).padStart(2, "0")}`;
}

function periodOf(time: string): "morning" | "afternoon" | "evening" {
  const minutes = toMinutes(time);
  if (minutes < 12 * 60) return "morning";
  if (minutes < 18 * 60) return "afternoon";
  return "evening";
}

function overlaps(busy: BusyInterval[], professionalId: string, startsAt: Date, endsAt: Date): boolean {
  return busy.some(
    (interval) =>
      interval.professionalId === professionalId && interval.startsAt < endsAt && interval.endsAt > startsAt,
  );
}

function candidates(request: SlotRequest): AvailableSlot[] {
  const today = todayKey(request.timeZone, request.now);
  const earliest = request.now.getTime() + request.minNoticeHours * 60 * 60 * 1000;
  const result: AvailableSlot[] = [];

  for (let offset = 0; offset <= request.maxDaysAhead; offset += 1) {
    const dateKey = addDaysToKey(today, offset);
    const ranges = request.weeklyHours[weekdayOf(dateKey)] ?? [];
    for (const range of ranges) {
      const end = toMinutes(range.end);
      for (let start = toMinutes(range.start); start + request.durationMinutes <= end; start += request.stepMinutes) {
        const time = toTime(start);
        const startsAt = zonedDateTime(dateKey, time, request.timeZone);
        if (startsAt.getTime() < earliest) continue;
        const endsAt = new Date(startsAt.getTime() + request.durationMinutes * 60 * 1000);
        const professionalId = request.professionalIds.find(
          (id) => !overlaps(request.busy, id, startsAt, endsAt),
        );
        if (professionalId) result.push({ startsAt, endsAt, professionalId, dateKey, time });
      }
    }
  }
  return result.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

function matches(slot: AvailableSlot, preference: SchedulePreference): boolean {
  if (preference.date && slot.dateKey !== preference.date) return false;
  if (preference.weekday !== undefined && weekdayOf(slot.dateKey) !== preference.weekday) return false;
  if (preference.period && periodOf(slot.time) !== preference.period) return false;
  return true;
}

function spread(slots: AvailableSlot[], maxOptions: number, maxPerDay: number): AvailableSlot[] {
  const perDay = new Map<string, number>();
  const chosen: AvailableSlot[] = [];
  for (const slot of slots) {
    const count = perDay.get(slot.dateKey) ?? 0;
    if (count >= maxPerDay) continue;
    perDay.set(slot.dateKey, count + 1);
    chosen.push(slot);
    if (chosen.length >= maxOptions) break;
  }
  return chosen;
}

export function computeAvailableSlots(request: SlotRequest): SlotResult {
  if (request.professionalIds.length === 0 || request.durationMinutes <= 0) {
    return { slots: [], matchedPreference: false };
  }
  const all = candidates(request);
  const preference = request.preference ?? {};
  const hasPreference = Boolean(preference.date || preference.period || preference.weekday !== undefined);
  // Data específica: pode oferecer vários horários do mesmo dia.
  const maxPerDay = preference.date ? request.maxOptions : (request.maxPerDay ?? 2);

  if (hasPreference) {
    const preferred = all.filter((slot) => matches(slot, preference));
    if (preferred.length > 0) {
      return { slots: spread(preferred, request.maxOptions, maxPerDay), matchedPreference: true };
    }
  }
  return {
    slots: spread(all, request.maxOptions, request.maxPerDay ?? 2),
    matchedPreference: !hasPreference,
  };
}

/** "Ter, 10/11 às 14:00" — rótulo curto para listar as opções no WhatsApp. */
export function formatSlotLabel(slot: { dateKey: string; time: string }): string {
  return `${formatKeyWeekdayShort(slot.dateKey)}, ${formatKeyDayMonth(slot.dateKey)} às ${slot.time}`;
}
