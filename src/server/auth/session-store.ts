import type { UserRole } from "@/generated/prisma/enums";
import type { DbExecutor } from "@/server/db/prisma";

import { generateSessionToken, hashSessionToken, isWellFormedSessionToken } from "./tokens";

/**
 * Persistência e validação de sessões. Recebe o cliente do banco por
 * parâmetro (e o "agora", nos testes) para ser testável e componível em transações.
 */

export interface SessionPolicy {
  /** Duração máxima absoluta da sessão. */
  maxAgeMs: number;
  /** Tempo máximo sem atividade antes de encerrar a sessão. */
  idleTimeoutMs: number;
  /** Intervalo mínimo entre atualizações de `lastActiveAt` (evita uma escrita por requisição). */
  touchIntervalMs: number;
}

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
}

export interface ValidatedSession {
  sessionId: string;
  expiresAt: Date;
  user: SessionUser;
}

export interface CreatedSession {
  token: string;
  sessionId: string;
  expiresAt: Date;
}

function truncate(value: string | null | undefined, max: number): string | null {
  if (!value) return null;
  return value.length > max ? value.slice(0, max) : value;
}

export async function createSession(
  db: DbExecutor,
  input: { userId: string; ipAddress?: string | null; userAgent?: string | null },
  policy: SessionPolicy,
  now: Date = new Date(),
): Promise<CreatedSession> {
  const token = generateSessionToken();
  const sessionId = hashSessionToken(token);
  const expiresAt = new Date(now.getTime() + policy.maxAgeMs);

  await db.session.create({
    data: {
      id: sessionId,
      userId: input.userId,
      expiresAt,
      lastActiveAt: now,
      createdAt: now,
      ipAddress: truncate(input.ipAddress, 45),
      userAgent: truncate(input.userAgent, 255),
    },
  });

  return { token, sessionId, expiresAt };
}

export async function validateSessionToken(
  db: DbExecutor,
  token: unknown,
  policy: SessionPolicy,
  now: Date = new Date(),
): Promise<ValidatedSession | null> {
  if (!isWellFormedSessionToken(token)) return null;

  const sessionId = hashSessionToken(token);
  const session = await db.session.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      expiresAt: true,
      lastActiveAt: true,
      user: { select: { id: true, name: true, email: true, role: true, isActive: true } },
    },
  });

  if (!session) return null;

  const isExpired = session.expiresAt.getTime() <= now.getTime();
  const isIdle = now.getTime() - session.lastActiveAt.getTime() > policy.idleTimeoutMs;

  if (isExpired || isIdle || !session.user.isActive) {
    await db.session.deleteMany({ where: { id: sessionId } });
    return null;
  }

  if (now.getTime() - session.lastActiveAt.getTime() >= policy.touchIntervalMs) {
    await db.session.updateMany({ where: { id: sessionId }, data: { lastActiveAt: now } });
  }

  const { isActive: _isActive, ...user } = session.user;
  return { sessionId, expiresAt: session.expiresAt, user };
}

export async function invalidateSession(db: DbExecutor, sessionId: string): Promise<void> {
  await db.session.deleteMany({ where: { id: sessionId } });
}

export async function invalidateUserSessions(db: DbExecutor, userId: string): Promise<number> {
  const result = await db.session.deleteMany({ where: { userId } });
  return result.count;
}

export async function deleteExpiredSessions(db: DbExecutor, now: Date = new Date()): Promise<number> {
  const result = await db.session.deleteMany({ where: { expiresAt: { lte: now } } });
  return result.count;
}
