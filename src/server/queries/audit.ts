import "server-only";

import { describeAuditDetail } from "@/lib/audit-labels";
import { requirePermission } from "@/server/auth/dal";
import { getDb } from "@/server/db";

/**
 * Consultas de auditoria. Cada função exige a permissão `audit:read` — a
 * verificação fica junto ao dado, não apenas na página que o exibe.
 */

export interface AuditEntryView {
  id: string;
  action: string;
  createdAt: Date;
  actorName: string | null;
  detail: string | null;
  ipAddress: string | null;
}

const AUDIT_SELECT = {
  id: true,
  action: true,
  createdAt: true,
  entityType: true,
  entityId: true,
  metadata: true,
  ipAddress: true,
  actor: { select: { name: true } },
} as const;

interface AuditRow {
  id: string;
  action: string;
  createdAt: Date;
  entityType: string | null;
  entityId: string | null;
  metadata: unknown;
  ipAddress: string | null;
  actor: { name: string } | null;
}

/**
 * Para eventos sobre outra conta (ex.: criação de usuário pela linha de comando,
 * sem autor), busca o nome da conta afetada em uma única consulta.
 */
async function resolveSubjectNames(rows: AuditRow[]): Promise<Map<string, string>> {
  const ids = [
    ...new Set(
      rows
        .filter((row) => row.action.startsWith("user.") && row.entityType === "user" && row.entityId)
        .map((row) => row.entityId as string),
    ),
  ];
  if (ids.length === 0) return new Map();
  const users = await getDb().user.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true },
  });
  return new Map(users.map((user) => [user.id, user.name]));
}

async function toViews(rows: AuditRow[]): Promise<AuditEntryView[]> {
  const subjects = await resolveSubjectNames(rows);
  return rows.map((row) => ({
    id: row.id,
    action: row.action,
    createdAt: row.createdAt,
    actorName: row.actor?.name ?? null,
    detail: describeAuditDetail(
      row.action,
      row.metadata,
      row.entityId ? subjects.get(row.entityId) : null,
    ),
    ipAddress: row.ipAddress,
  }));
}

export async function getRecentAuditEntries(limit = 100): Promise<AuditEntryView[]> {
  await requirePermission("audit:read");
  const rows = await getDb().auditLog.findMany({
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(limit, 1), 500),
    select: AUDIT_SELECT,
  });
  return toViews(rows);
}

/** Eventos de acesso (entradas, saídas e bloqueios) para o resumo do dashboard. */
export async function getRecentAccessEvents(limit = 6): Promise<AuditEntryView[]> {
  await requirePermission("audit:read");
  const rows = await getDb().auditLog.findMany({
    where: { action: { startsWith: "auth." } },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(limit, 1), 50),
    select: AUDIT_SELECT,
  });
  return toViews(rows);
}
