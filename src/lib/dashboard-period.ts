import {
  addDaysToKey,
  diffInDays,
  formatKeyDayMonth,
  startOfMonthKey,
  startOfWeekKey,
  zonedDateTime,
  type DateKey,
} from "@/lib/datetime";

/**
 * Períodos do dashboard. Todo período termina hoje (inclusive) no fuso da
 * clínica e é comparado com o período imediatamente anterior, de mesma duração.
 */

export const DASHBOARD_PERIODS = ["7d", "30d", "90d", "mes"] as const;
export type DashboardPeriod = (typeof DASHBOARD_PERIODS)[number];

export const PERIOD_LABELS: Record<DashboardPeriod, string> = {
  "7d": "7 dias",
  "30d": "30 dias",
  "90d": "90 dias",
  mes: "Este mês",
};

export interface PeriodRange {
  period: DashboardPeriod;
  firstDay: DateKey;
  lastDay: DateKey;
  /** Início (inclusivo) e fim (exclusivo) em UTC. */
  start: Date;
  end: Date;
  previousStart: Date;
  previousEnd: Date;
  /** Granularidade do gráfico de evolução. */
  bucket: "day" | "week";
  /** Texto para comparações: "vs 30 dias anteriores". */
  comparisonLabel: string;
}

export function resolvePeriod(period: DashboardPeriod, today: DateKey, timeZone: string): PeriodRange {
  const length = period === "7d" ? 7 : period === "30d" ? 30 : period === "90d" ? 90 : diffInDays(startOfMonthKey(today), today) + 1;
  const firstDay = period === "mes" ? startOfMonthKey(today) : addDaysToKey(today, -(length - 1));
  const previousFirst = addDaysToKey(firstDay, -length);
  return {
    period,
    firstDay,
    lastDay: today,
    start: zonedDateTime(firstDay, "00:00", timeZone),
    end: zonedDateTime(addDaysToKey(today, 1), "00:00", timeZone),
    previousStart: zonedDateTime(previousFirst, "00:00", timeZone),
    previousEnd: zonedDateTime(firstDay, "00:00", timeZone),
    bucket: length > 45 ? "week" : "day",
    comparisonLabel:
      period === "mes" ? `vs ${length} dia${length === 1 ? "" : "s"} anteriores` : `vs ${PERIOD_LABELS[period]} anteriores`,
  };
}

export interface TrendPoint {
  key: DateKey;
  label: string;
  value: number;
}

/**
 * Preenche os dias sem registros com zero e, em períodos longos, agrupa por
 * semana (segunda a domingo; a primeira semana pode começar no meio).
 */
export function buildTrend(range: Pick<PeriodRange, "firstDay" | "lastDay" | "bucket">, counts: Map<DateKey, number>): TrendPoint[] {
  const days: DateKey[] = [];
  for (let day = range.firstDay; day <= range.lastDay; day = addDaysToKey(day, 1)) days.push(day);

  if (range.bucket === "day") {
    return days.map((day) => ({ key: day, label: formatKeyDayMonth(day), value: counts.get(day) ?? 0 }));
  }

  const weeks = new Map<DateKey, TrendPoint>();
  for (const day of days) {
    const weekStart = startOfWeekKey(day);
    const key = weekStart < range.firstDay ? range.firstDay : weekStart;
    const point = weeks.get(key) ?? { key, label: `Semana de ${formatKeyDayMonth(key)}`, value: 0 };
    point.value += counts.get(day) ?? 0;
    weeks.set(key, point);
  }
  return [...weeks.values()];
}

/** Variação percentual em relação ao período anterior; `null` quando não há base. */
export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}
