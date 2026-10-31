import type { DbExecutor } from "@/server/db/prisma";

import { redact } from "./logging/redact";

/**
 * Trilha de auditoria (LGPD): registra QUEM fez O QUÊ, QUANDO e sobre QUAL
 * registro. Não registra o conteúdo dos dados — `metadata` aceita apenas
 * valores simples e passa por redação defensiva.
 *
 * Sem `server-only`: scripts administrativos de linha de comando também auditam.
 */

export const AUDIT_ACTIONS = [
  "auth.login.success",
  "auth.login.failure",
  "auth.login.blocked",
  "auth.logout",
  "auth.access_denied",
  "user.create",
  "user.password.reset",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export type AuditMetadata = Record<string, string | number | boolean | null>;

export interface AuditEntry {
  action: AuditAction;
  actorId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  metadata?: AuditMetadata;
  ipAddress?: string | null;
  userAgent?: string | null;
}

function truncate(value: string | null | undefined, max: number): string | null {
  if (!value) return null;
  return value.length > max ? value.slice(0, max) : value;
}

export async function recordAudit(db: DbExecutor, entry: AuditEntry): Promise<void> {
  await db.auditLog.create({
    data: {
      action: entry.action,
      actorId: entry.actorId ?? null,
      entityType: truncate(entry.entityType, 40),
      entityId: truncate(entry.entityId, 64),
      ...(entry.metadata ? { metadata: redact(entry.metadata) as AuditMetadata } : {}),
      ipAddress: truncate(entry.ipAddress, 45),
      userAgent: truncate(entry.userAgent, 255),
    },
  });
}
