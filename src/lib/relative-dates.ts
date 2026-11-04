import {
  dateKeyOf,
  diffInDays,
  formatKeyDayMonth,
  formatKeyWeekdayShort,
  timeOf,
} from "@/lib/datetime";

export interface DueLabel {
  label: string;
  overdue: boolean;
  today: boolean;
}

/**
 * Prazo legível para a equipe: "Hoje, 14:00", "Amanhã, 09:00", "Qua, 05/11",
 * "Atrasado desde 28/10". Calculado no servidor para não divergir na hidratação.
 */
export function describeDue(date: Date, timeZone: string, now: Date = new Date()): DueLabel {
  const key = dateKeyOf(date, timeZone);
  const todayKey = dateKeyOf(now, timeZone);
  const days = diffInDays(todayKey, key);
  const time = timeOf(date, timeZone);

  if (days === 0) return { label: `Hoje, ${time}`, overdue: date.getTime() < now.getTime(), today: true };
  if (days < 0) return { label: `Atrasada desde ${formatKeyDayMonth(key)}`, overdue: true, today: false };
  if (days === 1) return { label: `Amanhã, ${time}`, overdue: false, today: false };
  if (days < 7) return { label: `${formatKeyWeekdayShort(key)}, ${formatKeyDayMonth(key)}`, overdue: false, today: false };
  return { label: formatKeyDayMonth(key), overdue: false, today: false };
}

/** Para datas de calendário (retornos): "Hoje", "Amanhã", "Em 5 dias", "Atrasado há 3 dias". */
export function describeDueDateKey(key: string, todayKey: string): DueLabel {
  const days = diffInDays(todayKey, key);
  if (days === 0) return { label: "Hoje", overdue: false, today: true };
  if (days === 1) return { label: "Amanhã", overdue: false, today: false };
  if (days > 1) return { label: `Em ${days} dias`, overdue: false, today: false };
  if (days === -1) return { label: "Atrasado há 1 dia", overdue: true, today: false };
  return { label: `Atrasado há ${-days} dias`, overdue: true, today: false };
}
