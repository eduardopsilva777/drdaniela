import type { DbExecutor } from "@/server/db/prisma";

/**
 * Limite de tentativas de login (proteção contra força bruta), com janela deslizante.
 *
 * - Por e-mail: sempre ativo. Um login bem-sucedido zera a contagem.
 * - Por IP: ativo apenas quando o IP é confiável (TRUST_PROXY=true), pois sem um
 *   proxy reverso o cabeçalho X-Forwarded-For pode ser forjado pelo cliente.
 *
 * Tentativas bloqueadas não contam como falha (nenhuma senha foi verificada),
 * para não prolongar indefinidamente o bloqueio de quem está legitimamente aguardando.
 */

export interface LoginThrottlePolicy {
  windowMs: number;
  maxFailuresPerEmail: number;
  maxFailuresPerIp: number;
  ipLimitEnabled: boolean;
}

export const DEFAULT_LOGIN_THROTTLE_POLICY: LoginThrottlePolicy = {
  windowMs: 15 * 60 * 1000,
  maxFailuresPerEmail: 5,
  maxFailuresPerIp: 20,
  ipLimitEnabled: false,
};

export type ThrottleDecision =
  | { allowed: true }
  | { allowed: false; scope: "email" | "ip"; retryAfterSeconds: number };

function secondsUntil(target: number, now: Date): number {
  return Math.max(1, Math.ceil((target - now.getTime()) / 1000));
}

export async function checkLoginThrottle(
  db: DbExecutor,
  input: { email: string; ipAddress: string | null },
  policy: LoginThrottlePolicy,
  now: Date = new Date(),
): Promise<ThrottleDecision> {
  const windowStart = new Date(now.getTime() - policy.windowMs);

  const lastSuccess = await db.loginAttempt.findFirst({
    where: { email: input.email, success: true, createdAt: { gt: windowStart } },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });

  const emailFailures = await db.loginAttempt.findMany({
    where: {
      email: input.email,
      success: false,
      createdAt: { gt: lastSuccess?.createdAt ?? windowStart, lte: now },
    },
    orderBy: { createdAt: "desc" },
    take: policy.maxFailuresPerEmail,
    select: { createdAt: true },
  });

  if (emailFailures.length >= policy.maxFailuresPerEmail) {
    const oldestCounted = emailFailures[emailFailures.length - 1]!.createdAt;
    return {
      allowed: false,
      scope: "email",
      retryAfterSeconds: secondsUntil(oldestCounted.getTime() + policy.windowMs, now),
    };
  }

  if (policy.ipLimitEnabled && input.ipAddress) {
    const ipFailures = await db.loginAttempt.findMany({
      where: {
        ipAddress: input.ipAddress,
        success: false,
        createdAt: { gt: windowStart, lte: now },
      },
      orderBy: { createdAt: "desc" },
      take: policy.maxFailuresPerIp,
      select: { createdAt: true },
    });

    if (ipFailures.length >= policy.maxFailuresPerIp) {
      const oldestCounted = ipFailures[ipFailures.length - 1]!.createdAt;
      return {
        allowed: false,
        scope: "ip",
        retryAfterSeconds: secondsUntil(oldestCounted.getTime() + policy.windowMs, now),
      };
    }
  }

  return { allowed: true };
}

export async function recordLoginAttempt(
  db: DbExecutor,
  input: { email: string; ipAddress: string | null; success: boolean },
  now: Date = new Date(),
): Promise<void> {
  await db.loginAttempt.create({
    data: {
      email: input.email,
      ipAddress: input.ipAddress,
      success: input.success,
      createdAt: now,
    },
  });
}
