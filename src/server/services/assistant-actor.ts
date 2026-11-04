import "server-only";

import type { DbExecutor } from "@/server/db/prisma";

import type { Actor } from "./context";

/**
 * Conta de sistema do assistente virtual. Existe para registrar a autoria do
 * que o assistente faz (leads, agendamentos, mensagens) na auditoria e nos
 * históricos — com um perfil próprio e mínimo (ASSISTANT). Nunca faz login:
 * fica inativa, sem senha válida, e a autenticação recusa o perfil.
 */

export const ASSISTANT_USER_ID = "00000000-0000-7000-8000-0000000a5517";
export const ASSISTANT_USER_NAME = "Assistente virtual";
const ASSISTANT_USER_EMAIL = "assistente-virtual@sistema.invalid";

/** Garante a conta (idempotente) e devolve o ator usado pelos serviços. */
export async function getAssistantActor(db: DbExecutor): Promise<Actor> {
  await db.user.upsert({
    where: { id: ASSISTANT_USER_ID },
    create: {
      id: ASSISTANT_USER_ID,
      name: ASSISTANT_USER_NAME,
      email: ASSISTANT_USER_EMAIL,
      // Não é um hash argon2: nenhuma senha confere com este valor.
      passwordHash: "!conta-de-sistema-sem-login",
      role: "ASSISTANT",
      isActive: false,
    },
    update: {},
  });
  return { id: ASSISTANT_USER_ID, name: ASSISTANT_USER_NAME, role: "ASSISTANT", ipAddress: null, userAgent: "assistente-virtual" };
}
