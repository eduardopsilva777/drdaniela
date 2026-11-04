import "server-only";

import type { LeadSource, LeadStatus } from "@/generated/prisma/enums";
import { dateKeyToDbDate, dayRange, type DateKey } from "@/lib/datetime";
import type { PeriodRange } from "@/lib/dashboard-period";
import { requirePermission } from "@/server/auth/dal";
import { getDb } from "@/server/db";

/**
 * Indicadores do dashboard, calculados direto do banco (nenhum número fictício).
 * Definições documentadas em docs/fluxos-comerciais.md.
 */

/** Situação operacional de agora: agenda do dia, retornos e carteira. */
export async function getOperationalSnapshot(now: Date, today: DateKey, timeZone: string) {
  await Promise.all([
    requirePermission("appointments:read"),
    requirePermission("returns:read"),
    requirePermission("patients:read"),
    requirePermission("leads:read"),
  ]);
  const db = getDb();
  const day = dayRange(today, timeZone);
  const todayDate = dateKeyToDbDate(today);
  const weekAhead = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const [todayAppointments, upcomingCount, pendingReturns, overdueReturns, overdueList, activePatients, leadsByStatus] =
    await Promise.all([
      db.appointment.findMany({
        where: { startsAt: { gte: day.start, lt: day.end }, status: { not: "CANCELLED" } },
        orderBy: { startsAt: "asc" },
        take: 30,
        select: {
          id: true,
          startsAt: true,
          endsAt: true,
          status: true,
          patient: { select: { id: true, fullName: true } },
          lead: { select: { id: true, name: true } },
          procedure: { select: { name: true, color: true } },
          professional: { select: { name: true } },
        },
      }),
      db.appointment.count({ where: { startsAt: { gte: now, lt: weekAhead }, status: { in: ["SCHEDULED", "CONFIRMED"] } } }),
      db.patientReturn.count({ where: { status: "PENDING" } }),
      db.patientReturn.count({ where: { status: "PENDING", dueDate: { lt: todayDate } } }),
      db.patientReturn.findMany({
        where: { status: "PENDING", dueDate: { lt: todayDate } },
        orderBy: { dueDate: "asc" },
        take: 6,
        select: { id: true, title: true, dueDate: true, patient: { select: { id: true, fullName: true } } },
      }),
      db.patient.count({ where: { isActive: true } }),
      db.lead.groupBy({ by: ["status"], _count: { _all: true } }),
    ]);

  const leadCounts = Object.fromEntries(leadsByStatus.map((row) => [row.status, row._count._all])) as Partial<
    Record<LeadStatus, number>
  >;
  const leadsTotal = leadsByStatus.reduce((total, row) => total + row._count._all, 0);

  return {
    todayAppointments,
    upcomingCount,
    pendingReturns,
    overdueReturns,
    overdueList,
    activePatients,
    leadsTotal,
    leadsInProgress: leadCounts.IN_PROGRESS ?? 0,
    leadsOpen: (leadCounts.NEW ?? 0) + (leadCounts.IN_PROGRESS ?? 0) + (leadCounts.SCHEDULED ?? 0),
  };
}

const FUNNEL_RANK: Record<LeadStatus, number> = { NEW: 0, IN_PROGRESS: 1, SCHEDULED: 2, CONVERTED: 3, LOST: -1 };

/** Desempenho comercial no período (e no período anterior, para comparação). */
export async function getCommercialPerformance(range: PeriodRange, timeZone: string) {
  await requirePermission("leads:read");
  const db = getDb();
  const inPeriod = { gte: range.start, lt: range.end };
  const inPrevious = { gte: range.previousStart, lt: range.previousEnd };

  const [newLeads, previousNewLeads, cohort, bySource, daily, convertedInPeriod, lostInPeriod, records, previousRecords] =
    await Promise.all([
      db.lead.count({ where: { createdAt: inPeriod } }),
      db.lead.count({ where: { createdAt: inPrevious } }),
      db.lead.groupBy({ by: ["peakStatus", "status"], where: { createdAt: inPeriod }, _count: { _all: true } }),
      db.lead.groupBy({ by: ["source"], where: { createdAt: inPeriod }, _count: { _all: true } }),
      db.$queryRaw<Array<{ day: string; total: number }>>`
        SELECT to_char(("created_at" AT TIME ZONE ${timeZone})::date, 'YYYY-MM-DD') AS "day", count(*)::int AS "total"
        FROM "leads"
        WHERE "created_at" >= ${range.start} AND "created_at" < ${range.end}
        GROUP BY 1
        ORDER BY 1`,
      db.lead.count({ where: { convertedAt: inPeriod } }),
      db.lead.count({ where: { status: "LOST", lostAt: inPeriod } }),
      db.procedureRecord.count({ where: { performedAt: inPeriod } }),
      db.procedureRecord.count({ where: { performedAt: inPrevious } }),
    ]);

  // Funil da coorte: dos leads criados no período, quantos alcançaram cada etapa
  // (pela etapa mais avançada já atingida — inclui os que depois foram perdidos).
  const reached = { NEW: 0, IN_PROGRESS: 0, SCHEDULED: 0, CONVERTED: 0 };
  let cohortConverted = 0;
  for (const row of cohort) {
    const count = row._count._all;
    const rank = FUNNEL_RANK[row.peakStatus];
    reached.NEW += count;
    if (rank >= 1) reached.IN_PROGRESS += count;
    if (rank >= 2) reached.SCHEDULED += count;
    if (rank >= 3) reached.CONVERTED += count;
    if (row.status === "CONVERTED") cohortConverted += count;
  }

  return {
    newLeads,
    previousNewLeads,
    conversionRate: newLeads > 0 ? cohortConverted / newLeads : null,
    cohortConverted,
    funnel: reached,
    bySource: bySource
      .map((row) => ({ source: row.source as LeadSource, total: row._count._all }))
      .sort((a, b) => b.total - a.total),
    dailyCounts: new Map(daily.map((row) => [row.day, row.total])),
    convertedInPeriod,
    lostInPeriod,
    proceduresPerformed: records,
    previousProceduresPerformed: previousRecords,
  };
}
