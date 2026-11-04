import { TZDate, tz } from "@date-fns/tz";
import { format } from "date-fns";

/**
 * Datas e horários da clínica.
 *
 * Dois tipos de valor circulam no sistema:
 * - Instantes (`Date`): horários de agendamentos, gravados em UTC (`timestamptz`).
 * - Datas de calendário (`DateKey`, "AAAA-MM-DD"): retornos, nascimento etc.,
 *   gravadas como `date`. A aritmética com elas é puramente de calendário (UTC),
 *   sem fuso — só a conversão instante ↔ data local depende do fuso da clínica.
 */

export const DEFAULT_CLINIC_TIME_ZONE = "America/Sao_Paulo";

export type DateKey = string;

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DAY_MS = 24 * 60 * 60 * 1000;

function splitKey(key: DateKey): [number, number, number] {
  const [year, month, day] = key.split("-").map(Number);
  return [year!, month!, day!];
}

export function isDateKey(value: unknown): value is DateKey {
  if (typeof value !== "string" || !DATE_KEY_PATTERN.test(value)) return false;
  const [year, month, day] = splitKey(value);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

export function isTimeOfDay(value: unknown): value is string {
  return typeof value === "string" && TIME_PATTERN.test(value);
}

/** Data local + hora local (no fuso da clínica) → instante UTC. */
export function zonedDateTime(key: DateKey, time: string, timeZone = DEFAULT_CLINIC_TIME_ZONE): Date {
  const [year, month, day] = splitKey(key);
  const [hours, minutes] = time.split(":").map(Number);
  return new Date(new TZDate(year, month - 1, day, hours!, minutes!, timeZone).getTime());
}

/** Instante → data de calendário no fuso da clínica. */
export function dateKeyOf(date: Date, timeZone = DEFAULT_CLINIC_TIME_ZONE): DateKey {
  return format(date, "yyyy-MM-dd", { in: tz(timeZone) });
}

/** Instante → "HH:mm" no fuso da clínica. */
export function timeOf(date: Date, timeZone = DEFAULT_CLINIC_TIME_ZONE): string {
  return format(date, "HH:mm", { in: tz(timeZone) });
}

/** Minutos desde a meia-noite local (para posicionar blocos na agenda). */
export function minutesOfDay(date: Date, timeZone = DEFAULT_CLINIC_TIME_ZONE): number {
  const [hours, minutes] = timeOf(date, timeZone).split(":").map(Number);
  return hours! * 60 + minutes!;
}

export function todayKey(timeZone = DEFAULT_CLINIC_TIME_ZONE, now: Date = new Date()): DateKey {
  return dateKeyOf(now, timeZone);
}

export function addDaysToKey(key: DateKey, days: number): DateKey {
  const [year, month, day] = splitKey(key);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

export function addMonthsToKey(key: DateKey, months: number): DateKey {
  const [year, month, day] = splitKey(key);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString().slice(0, 10);
}

/** Dias entre duas datas de calendário (positivo quando `to` é posterior). */
export function diffInDays(from: DateKey, to: DateKey): number {
  return Math.round((dateKeyToDbDate(to).getTime() - dateKeyToDbDate(from).getTime()) / DAY_MS);
}

/** 0 = domingo … 6 = sábado. */
export function weekdayOf(key: DateKey): number {
  return dateKeyToDbDate(key).getUTCDay();
}

export function startOfWeekKey(key: DateKey): DateKey {
  return addDaysToKey(key, -((weekdayOf(key) + 6) % 7)); // semana começa na segunda
}

export function startOfMonthKey(key: DateKey): DateKey {
  return `${key.slice(0, 8)}01`;
}

/** Colunas `date` do banco trafegam como meia-noite UTC. */
export function dateKeyToDbDate(key: DateKey): Date {
  return new Date(`${key}T00:00:00.000Z`);
}

export function dbDateToKey(date: Date): DateKey {
  return date.toISOString().slice(0, 10);
}

export interface ZonedRange {
  /** Primeiro instante do intervalo (inclusivo). */
  start: Date;
  /** Instante logo após o fim do intervalo (exclusivo). */
  end: Date;
  days: DateKey[];
}

function rangeOfDays(firstKey: DateKey, count: number, timeZone: string): ZonedRange {
  const days = Array.from({ length: count }, (_, index) => addDaysToKey(firstKey, index));
  return {
    start: zonedDateTime(firstKey, "00:00", timeZone),
    end: zonedDateTime(addDaysToKey(firstKey, count), "00:00", timeZone),
    days,
  };
}

export function dayRange(key: DateKey, timeZone = DEFAULT_CLINIC_TIME_ZONE): ZonedRange {
  return rangeOfDays(key, 1, timeZone);
}

export function weekRange(key: DateKey, timeZone = DEFAULT_CLINIC_TIME_ZONE): ZonedRange {
  return rangeOfDays(startOfWeekKey(key), 7, timeZone);
}

/** Grade do mês: semanas completas (segunda a domingo) que cobrem o mês. */
export function monthGridRange(key: DateKey, timeZone = DEFAULT_CLINIC_TIME_ZONE): ZonedRange {
  const first = startOfMonthKey(key);
  const last = addDaysToKey(addMonthsToKey(first, 1), -1);
  const gridStart = startOfWeekKey(first);
  const gridEnd = addDaysToKey(startOfWeekKey(last), 6);
  return rangeOfDays(gridStart, diffInDays(gridStart, gridEnd) + 1, timeZone);
}

const WEEKDAY_SHORT = new Intl.DateTimeFormat("pt-BR", { weekday: "short", timeZone: "UTC" });
const WEEKDAY_LONG = new Intl.DateTimeFormat("pt-BR", { weekday: "long", timeZone: "UTC" });
const DAY_MONTH = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "UTC" });
const DAY_MONTH_LONG = new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "long", timeZone: "UTC" });
const MONTH_YEAR = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });
const FULL_DATE = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function formatKeyWeekdayShort(key: DateKey): string {
  return capitalize(WEEKDAY_SHORT.format(dateKeyToDbDate(key)).replace(".", ""));
}

export function formatKeyWeekdayLong(key: DateKey): string {
  return capitalize(WEEKDAY_LONG.format(dateKeyToDbDate(key)));
}

export function formatKeyDayMonth(key: DateKey): string {
  return DAY_MONTH.format(dateKeyToDbDate(key));
}

export function formatKeyDayMonthLong(key: DateKey): string {
  return DAY_MONTH_LONG.format(dateKeyToDbDate(key));
}

export function formatKeyMonthYear(key: DateKey): string {
  return capitalize(MONTH_YEAR.format(dateKeyToDbDate(key)));
}

/** "03/11/2026" a partir de uma data de calendário. */
export function formatKeyDate(key: DateKey): string {
  return FULL_DATE.format(dateKeyToDbDate(key));
}

/** Idade em anos completos na data de referência. */
export function ageOn(birthKey: DateKey, referenceKey: DateKey): number {
  const [birthYear, birthMonth, birthDay] = splitKey(birthKey);
  const [refYear, refMonth, refDay] = splitKey(referenceKey);
  let age = refYear - birthYear;
  if (refMonth < birthMonth || (refMonth === birthMonth && refDay < birthDay)) age -= 1;
  return age;
}
