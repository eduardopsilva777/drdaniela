import { recordAudit } from "@/server/audit";
import type { DbClient } from "@/server/db/prisma";

/**
 * Política de retenção de DADOS TÉCNICOS (LGPD, art. 15 e 16: eliminar o que
 * não é mais necessário para a finalidade). Atinge apenas registros de
 * segurança e operação — nunca dados de pacientes, leads ou agenda, cuja
 * eliminação é decisão caso a caso (pedido do titular) ou de política jurídica.
 *
 * Sem `server-only`: executada pela linha de comando (`npm run data:retention`).
 */

export const RETENTION_POLICY = {
  /** Tentativas de login (usadas no limite de tentativas e na investigação de incidentes). */
  loginAttemptsDays: 90,
  /** Registro de eventos de webhook (sem conteúdo de mensagens), usado para deduplicação. */
  webhookEventsDays: 90,
} as const;

export interface RetentionReport {
  apply: boolean;
  expiredSessions: number;
  loginAttempts: number;
  webhookEvents: number;
}

const DAY = 24 * 60 * 60 * 1000;

export async function runRetention(
  db: DbClient,
  options: { apply: boolean; now?: Date; source?: string },
): Promise<RetentionReport> {
  const now = options.now ?? new Date();
  const sessionsWhere = { expiresAt: { lte: now } };
  const attemptsWhere = { createdAt: { lt: new Date(now.getTime() - RETENTION_POLICY.loginAttemptsDays * DAY) } };
  const webhookWhere = { receivedAt: { lt: new Date(now.getTime() - RETENTION_POLICY.webhookEventsDays * DAY) } };

  if (!options.apply) {
    const [expiredSessions, loginAttempts, webhookEvents] = await Promise.all([
      db.session.count({ where: sessionsWhere }),
      db.loginAttempt.count({ where: attemptsWhere }),
      db.webhookEvent.count({ where: webhookWhere }),
    ]);
    return { apply: false, expiredSessions, loginAttempts, webhookEvents };
  }

  return db.$transaction(async (tx) => {
    const expiredSessions = (await tx.session.deleteMany({ where: sessionsWhere })).count;
    const loginAttempts = (await tx.loginAttempt.deleteMany({ where: attemptsWhere })).count;
    const webhookEvents = (await tx.webhookEvent.deleteMany({ where: webhookWhere })).count;
    await recordAudit(tx, {
      action: "data.retention.run",
      metadata: { source: options.source ?? "cli", expiredSessions, loginAttempts, webhookEvents },
    });
    return { apply: true, expiredSessions, loginAttempts, webhookEvents };
  });
}
