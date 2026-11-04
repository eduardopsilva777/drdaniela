import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import type { ReminderStatus } from "@/generated/prisma/enums";
import { addDaysToKey, dateKeyToDbDate } from "@/lib/datetime";
import { phoneDigits } from "@/lib/phone";
import type { ReturnFilters } from "@/lib/validation/care";
import { requirePermission } from "@/server/auth/dal";
import { getDb } from "@/server/db";

/**
 * Consultas do módulo de protocolos e retornos: fila de trabalho de retornos,
 * fila de lembretes e catálogo de protocolos.
 */

export const CARE_PAGE_SIZE = 25;
/** "Próximos" = retornos nos próximos 14 dias. */
export const UPCOMING_DAYS = 14;

function patientSearch(query: string | undefined): Prisma.PatientWhereInput | undefined {
  if (!query) return undefined;
  const digits = phoneDigits(query);
  return {
    OR: [
      { fullName: { contains: query, mode: "insensitive" } },
      { preferredName: { contains: query, mode: "insensitive" } },
      ...(digits.length >= 3 ? [{ phone: { contains: digits } }] : []),
    ],
  };
}

function returnsWhere(situacao: ReturnFilters["situacao"], today: string): Prisma.PatientReturnWhereInput {
  const todayDate = dateKeyToDbDate(today);
  switch (situacao) {
    case "atrasados":
      return { status: "PENDING", dueDate: { lt: todayDate } };
    case "proximos":
      return {
        status: { in: ["PENDING", "SCHEDULED"] },
        dueDate: { gte: todayDate, lte: dateKeyToDbDate(addDaysToKey(today, UPCOMING_DAYS)) },
      };
    case "resolvidos":
      return { status: { in: ["COMPLETED", "CANCELLED"] } };
    default:
      return { status: { in: ["PENDING", "MISSED"] } };
  }
}

export async function listReturnsWorklist(filters: ReturnFilters, today: string) {
  await requirePermission("returns:read");
  const db = getDb();
  const search = patientSearch(filters.busca);
  const where: Prisma.PatientReturnWhereInput = {
    AND: [returnsWhere(filters.situacao, today), ...(search ? [{ patient: search }] : [])],
  };
  const todayDate = dateKeyToDbDate(today);

  const [total, items, overdue, upcoming, open] = await Promise.all([
    db.patientReturn.count({ where }),
    db.patientReturn.findMany({
      where,
      orderBy: filters.situacao === "resolvidos" ? [{ resolvedAt: "desc" }] : [{ dueDate: "asc" }, { createdAt: "asc" }],
      skip: (filters.pagina - 1) * CARE_PAGE_SIZE,
      take: CARE_PAGE_SIZE,
      select: {
        id: true,
        title: true,
        kind: true,
        dueDate: true,
        status: true,
        resolvedAt: true,
        procedure: { select: { id: true, name: true } },
        patientProtocol: { select: { protocol: { select: { name: true } } } },
        appointment: { select: { startsAt: true } },
        patient: { select: { id: true, fullName: true, phone: true, isActive: true, whatsappOptIn: true } },
      },
    }),
    db.patientReturn.count({ where: { status: "PENDING", dueDate: { lt: todayDate } } }),
    db.patientReturn.count({ where: returnsWhere("proximos", today) }),
    db.patientReturn.count({ where: returnsWhere("pendentes", today) }),
  ]);
  return { total, items, counts: { overdue, upcoming, open } };
}

export async function listReminders(status: ReminderStatus | undefined, search: string | undefined, page: number) {
  await requirePermission("returns:read");
  const db = getDb();
  const patient = patientSearch(search);
  const where: Prisma.ReminderWhereInput = {
    ...(status ? { status } : {}),
    ...(patient ? { OR: [{ patient }, { lead: { name: { contains: search!, mode: "insensitive" } } }] } : {}),
  };
  const [total, items, grouped] = await Promise.all([
    db.reminder.count({ where }),
    db.reminder.findMany({
      where,
      orderBy: status === "PENDING" || status === "PROCESSING" ? [{ scheduledFor: "asc" }] : [{ updatedAt: "desc" }],
      skip: (page - 1) * CARE_PAGE_SIZE,
      take: CARE_PAGE_SIZE,
      select: {
        id: true,
        kind: true,
        status: true,
        scheduledFor: true,
        sentAt: true,
        attempts: true,
        maxAttempts: true,
        nextAttemptAt: true,
        simulated: true,
        lastError: true,
        cancelledAt: true,
        pausedAt: true,
        channel: true,
        returnId: true,
        procedure: { select: { name: true } },
        patient: { select: { id: true, fullName: true } },
        lead: { select: { id: true, name: true } },
        return: { select: { title: true, dueDate: true, status: true } },
        appointment: { select: { startsAt: true } },
        followUpRule: { select: { daysBefore: true, action: true } },
        message: { select: { status: true } },
        task: { select: { status: true } },
      },
    }),
    db.reminder.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);
  const counts = Object.fromEntries(grouped.map((group) => [group.status, group._count._all])) as Partial<
    Record<ReminderStatus, number>
  >;
  return { total, items, counts };
}

export async function listProtocols(includeInactive: boolean) {
  await requirePermission("procedures:read");
  const rows = await getDb().protocol.findMany({
    where: includeInactive ? undefined : { isActive: true },
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      description: true,
      durationDays: true,
      isActive: true,
      procedure: { select: { id: true, name: true, isActive: true } },
      steps: {
        orderBy: { position: "asc" },
        select: { id: true, position: true, label: true, kind: true, offsetDays: true, relativeTo: true },
      },
      followUpRules: {
        orderBy: [{ daysBefore: "desc" }, { action: "asc" }],
        select: {
          id: true,
          daysBefore: true,
          action: true,
          taskTitle: true,
          stepKinds: true,
          template: { select: { id: true, name: true, status: true } },
        },
      },
      _count: { select: { patientProtocols: { where: { status: "ACTIVE" } } } },
    },
  });
  return rows;
}
