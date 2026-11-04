import "server-only";

import { normalizeEmail } from "@/lib/validation/auth";
import { recordAudit } from "@/server/audit";
import type { DbClient } from "@/server/db/prisma";

import { checkLoginThrottle, recordLoginAttempt, type LoginThrottlePolicy } from "./login-throttle";
import {
  burnPasswordVerification,
  hashPassword,
  passwordNeedsRehash,
  verifyPassword,
} from "./password";
import {
  createSession,
  type CreatedSession,
  type SessionPolicy,
  type SessionUser,
} from "./session-store";

export interface AuthenticateInput {
  email: string;
  password: string;
  ipAddress: string | null;
  userAgent: string | null;
}

export type AuthenticationResult =
  | { ok: true; session: CreatedSession; user: SessionUser }
  | { ok: false; reason: "invalid_credentials" }
  | { ok: false; reason: "blocked"; retryAfterSeconds: number };

/**
 * Fluxo completo de login por e-mail e senha.
 *
 * Garantias:
 * - Resposta externa idêntica para e-mail inexistente, senha errada e usuário
 *   desativado (sem enumeração de contas); o motivo real fica só na auditoria.
 * - Tempo de resposta equivalente mesmo quando o e-mail não existe.
 * - Sessão, registro da tentativa e auditoria gravados na mesma transação.
 */
export async function authenticateWithPassword(
  db: DbClient,
  input: AuthenticateInput,
  policies: { session: SessionPolicy; throttle: LoginThrottlePolicy },
  now: Date = new Date(),
): Promise<AuthenticationResult> {
  const email = normalizeEmail(input.email);
  const { ipAddress, userAgent } = input;

  const decision = await checkLoginThrottle(db, { email, ipAddress }, policies.throttle, now);
  if (!decision.allowed) {
    await recordAudit(db, {
      action: "auth.login.blocked",
      metadata: { scope: decision.scope },
      ipAddress,
      userAgent,
    });
    return { ok: false, reason: "blocked", retryAfterSeconds: decision.retryAfterSeconds };
  }

  const user = await db.user.findUnique({
    where: { email },
    select: { id: true, name: true, email: true, role: true, isActive: true, passwordHash: true, mustChangePassword: true },
  });

  const passwordMatches = user
    ? await verifyPassword(user.passwordHash, input.password)
    : await burnPasswordVerification(input.password);

  // A conta de sistema do assistente virtual nunca faz login (defesa em profundidade:
  // ela já é inativa e não tem senha válida).
  const systemAccount = user?.role === "ASSISTANT";
  if (!user || !passwordMatches || !user.isActive || systemAccount) {
    const reason = !user
      ? "unknown_user"
      : systemAccount
        ? "system_account"
        : !passwordMatches
          ? "wrong_password"
          : "inactive_user";
    await db.$transaction(async (tx) => {
      await recordLoginAttempt(tx, { email, ipAddress, success: false }, now);
      await recordAudit(tx, {
        actorId: user?.id ?? null,
        action: "auth.login.failure",
        entityType: user ? "user" : null,
        entityId: user?.id ?? null,
        metadata: { reason },
        ipAddress,
        userAgent,
      });
    });
    return { ok: false, reason: "invalid_credentials" };
  }

  const upgradedHash = passwordNeedsRehash(user.passwordHash)
    ? await hashPassword(input.password)
    : null;

  const session = await db.$transaction(async (tx) => {
    await recordLoginAttempt(tx, { email, ipAddress, success: true }, now);
    await tx.user.update({
      where: { id: user.id },
      data: { lastLoginAt: now, ...(upgradedHash ? { passwordHash: upgradedHash } : {}) },
    });
    const created = await createSession(tx, { userId: user.id, ipAddress, userAgent }, policies.session, now);
    await recordAudit(tx, {
      actorId: user.id,
      action: "auth.login.success",
      entityType: "user",
      entityId: user.id,
      ipAddress,
      userAgent,
    });
    return created;
  });

  return {
    ok: true,
    session,
    user: { id: user.id, name: user.name, email: user.email, role: user.role, mustChangePassword: user.mustChangePassword },
  };
}
