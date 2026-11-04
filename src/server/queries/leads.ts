import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import type { LeadPriority, LeadSource, LeadStatus } from "@/generated/prisma/enums";
import { LEAD_STATUS_ORDER } from "@/lib/labels";
import { phoneDigits } from "@/lib/phone";
import type { LeadFilters } from "@/lib/validation/leads";
import { requirePermission } from "@/server/auth/dal";
import { getDb } from "@/server/db";
import { NotFoundError } from "@/server/errors";

/** Colunas "Convertido" e "Perdido" mostram só os movimentos recentes no quadro. */
export const CLOSED_COLUMNS_WINDOW_DAYS = 60;
const BOARD_COLUMN_LIMIT = 60;
export const LEADS_PAGE_SIZE = 20;

export interface LeadCardView {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  whatsappOptIn: boolean;
  status: LeadStatus;
  priority: LeadPriority;
  source: LeadSource;
  interest: string | null;
  ownerName: string | null;
  nextActionAt: Date | null;
  nextActionNote: string | null;
  statusChangedAt: Date;
  createdAt: Date;
  lostReason: string | null;
  patientId: string | null;
}

const CARD_SELECT = {
  id: true,
  name: true,
  phone: true,
  email: true,
  whatsappOptIn: true,
  status: true,
  priority: true,
  source: true,
  interest: true,
  nextActionAt: true,
  nextActionNote: true,
  statusChangedAt: true,
  createdAt: true,
  lostReason: true,
  patientId: true,
  owner: { select: { name: true } },
  procedure: { select: { name: true } },
} as const satisfies Prisma.LeadSelect;

type CardRow = Prisma.LeadGetPayload<{ select: typeof CARD_SELECT }>;

function toCard(row: CardRow): LeadCardView {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    whatsappOptIn: row.whatsappOptIn,
    status: row.status,
    priority: row.priority,
    source: row.source,
    interest: row.procedure?.name ?? row.interest,
    ownerName: row.owner?.name ?? null,
    nextActionAt: row.nextActionAt,
    nextActionNote: row.nextActionNote,
    statusChangedAt: row.statusChangedAt,
    createdAt: row.createdAt,
    lostReason: row.lostReason,
    patientId: row.patientId,
  };
}

function buildWhere(filters: LeadFilters): Prisma.LeadWhereInput {
  const conditions: Prisma.LeadWhereInput[] = [];
  if (filters.busca) {
    const query = filters.busca;
    const digits = phoneDigits(query);
    conditions.push({
      OR: [
        { name: { contains: query, mode: "insensitive" } },
        { email: { contains: query, mode: "insensitive" } },
        ...(digits.length >= 3 ? [{ phone: { contains: digits } }] : []),
      ],
    });
  }
  if (filters.origem) conditions.push({ source: filters.origem });
  if (filters.responsavel === "sem") conditions.push({ ownerId: null });
  else if (filters.responsavel) conditions.push({ ownerId: filters.responsavel });
  if (filters.prioridade) conditions.push({ priority: filters.prioridade });
  return { AND: conditions };
}

export interface BoardColumn {
  status: LeadStatus;
  total: number;
  items: LeadCardView[];
}

export async function getLeadBoard(filters: LeadFilters, now: Date = new Date()): Promise<BoardColumn[]> {
  await requirePermission("leads:read");
  const db = getDb();
  const base = buildWhere(filters);
  const since = new Date(now.getTime() - CLOSED_COLUMNS_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  return Promise.all(
    LEAD_STATUS_ORDER.map(async (status) => {
      const where: Prisma.LeadWhereInput = {
        AND: [
          base,
          { status },
          ...(status === "CONVERTED" || status === "LOST" ? [{ statusChangedAt: { gte: since } }] : []),
        ],
      };
      const [total, rows] = await Promise.all([
        db.lead.count({ where }),
        db.lead.findMany({
          where,
          select: CARD_SELECT,
          orderBy:
            status === "CONVERTED" || status === "LOST"
              ? [{ statusChangedAt: "desc" }]
              : [{ priority: "desc" }, { nextActionAt: { sort: "asc", nulls: "last" } }, { updatedAt: "desc" }],
          take: BOARD_COLUMN_LIMIT,
        }),
      ]);
      return { status, total, items: rows.map(toCard) };
    }),
  );
}

const SORTS: Record<LeadFilters["ordem"], Prisma.LeadOrderByWithRelationInput[]> = {
  recentes: [{ createdAt: "desc" }],
  antigos: [{ createdAt: "asc" }],
  nome: [{ name: "asc" }],
  proxima_acao: [{ nextActionAt: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
  prioridade: [{ priority: "desc" }, { createdAt: "desc" }],
};

export async function getLeadTable(filters: LeadFilters) {
  await requirePermission("leads:read");
  const db = getDb();
  const where: Prisma.LeadWhereInput = {
    AND: [buildWhere(filters), ...(filters.status ? [{ status: filters.status }] : [])],
  };
  const [total, rows] = await Promise.all([
    db.lead.count({ where }),
    db.lead.findMany({
      where,
      select: CARD_SELECT,
      orderBy: SORTS[filters.ordem],
      skip: (filters.pagina - 1) * LEADS_PAGE_SIZE,
      take: LEADS_PAGE_SIZE,
    }),
  ]);
  return { total, items: rows.map(toCard) };
}

export async function getLeadDetail(leadId: string) {
  await requirePermission("leads:read");
  const lead = await getDb().lead.findUnique({
    where: { id: leadId },
    include: {
      owner: { select: { id: true, name: true } },
      procedure: { select: { id: true, name: true } },
      patient: { select: { id: true, fullName: true } },
      interactions: {
        orderBy: { occurredAt: "desc" },
        take: 200,
        include: { author: { select: { name: true } } },
      },
      appointments: {
        orderBy: { startsAt: "desc" },
        take: 20,
        select: {
          id: true,
          startsAt: true,
          endsAt: true,
          status: true,
          procedure: { select: { name: true } },
          professional: { select: { name: true } },
        },
      },
    },
  });
  if (!lead) throw new NotFoundError("Lead");
  return lead;
}

export type LeadDetail = Awaited<ReturnType<typeof getLeadDetail>>;

/** Leads com próxima ação vencida ou nos próximos dias (dashboard e lembretes comerciais). */
export async function getUpcomingCommercialActions(now: Date, horizonDays: number, limit: number) {
  await requirePermission("leads:read");
  const until = new Date(now.getTime() + horizonDays * 24 * 60 * 60 * 1000);
  const rows = await getDb().lead.findMany({
    where: { status: { in: ["NEW", "IN_PROGRESS", "SCHEDULED"] }, nextActionAt: { not: null, lte: until } },
    select: CARD_SELECT,
    orderBy: { nextActionAt: "asc" },
    take: limit,
  });
  return rows.map(toCard);
}
