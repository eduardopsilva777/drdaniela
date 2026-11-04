import "server-only";

import { redirect } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";

import { hasPermission, type Permission } from "@/lib/auth/permissions";
import { recordAudit } from "@/server/audit";
import { getDb } from "@/server/db";
import { logger } from "@/server/logger";
import { getRequestMeta } from "@/server/request-meta";

import { readSessionToken } from "./cookies";
import { AuthorizationError } from "./errors";
import { getSessionPolicy } from "./policy";
import { validateSessionToken, type SessionUser, type ValidatedSession } from "./session-store";

/**
 * Camada de Acesso a Dados (DAL) — ponto único de verificação de sessão.
 *
 * Toda leitura de dados protegidos e toda Server Action devem passar por aqui.
 * A sessão é validada no banco a cada requisição (sem cache entre requisições);
 * `cache()` apenas evita consultas repetidas dentro da mesma renderização.
 */

export const getCurrentSession = cache(async (): Promise<ValidatedSession | null> => {
  // Interrompe qualquer prerender aqui: com Partial Prefetching, rotas que leem
  // cookies poderiam ter conteúdo autenticado pré-renderizado e guardado no
  // navegador. Sessão e dados protegidos só são resolvidos na requisição real.
  await connection();
  const token = await readSessionToken();
  if (!token) return null;
  return validateSessionToken(getDb(), token, getSessionPolicy());
});

export async function getCurrentUser(): Promise<SessionUser | null> {
  return (await getCurrentSession())?.user ?? null;
}

export const PASSWORD_CHANGE_PATH = "/conta/senha";

/**
 * Exige sessão válida; caso contrário redireciona para o login. Com senha
 * provisória pendente, toda página e operação leva à troca de senha — exceto
 * a própria tela de troca (`allowPendingPasswordChange`).
 */
export async function requireUser(
  options: { allowPendingPasswordChange?: boolean } = {},
): Promise<SessionUser> {
  const session = await getCurrentSession();
  if (!session) redirect("/login");
  if (session.user.mustChangePassword && !options.allowPendingPasswordChange) redirect(PASSWORD_CHANGE_PATH);
  return session.user;
}

/**
 * Para páginas: informa se o usuário tem a permissão, sem lançar erro,
 * para que a página exiba um estado de "acesso restrito".
 */
export async function checkPermission(
  permission: Permission,
): Promise<{ user: SessionUser; allowed: boolean }> {
  const user = await requireUser();
  const allowed = hasPermission(user.role, permission);
  if (!allowed) {
    logger.warn("auth.page_access_denied", { userId: user.id, permission });
  }
  return { user, allowed };
}

/**
 * Para Server Actions e Route Handlers: exige a permissão, registra a negativa
 * na auditoria e lança `AuthorizationError`.
 */
export async function requirePermission(permission: Permission): Promise<SessionUser> {
  const user = await requireUser();
  if (hasPermission(user.role, permission)) return user;

  const meta = await getRequestMeta();
  await recordAudit(getDb(), {
    actorId: user.id,
    action: "auth.access_denied",
    metadata: { permission },
    ...meta,
  });
  logger.warn("auth.access_denied", { userId: user.id, permission });
  throw new AuthorizationError(permission);
}
