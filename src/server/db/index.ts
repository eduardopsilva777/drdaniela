import "server-only";

import { getServerEnv } from "@/server/env";

import { createPrismaClient, type DbClient } from "./prisma";

export type { DbClient, DbExecutor } from "./prisma";

const globalForDb = globalThis as unknown as { __crmPrisma?: DbClient };

/**
 * Instância única do Prisma Client por processo (reutilizada entre recargas
 * do servidor de desenvolvimento para não esgotar conexões).
 *
 * Em produção o Prisma não imprime erros por conta própria: essas mensagens
 * podem repetir os argumentos da consulta (nomes, telefones) e não passam pela
 * redação. Os erros continuam sendo lançados e são registrados pelo logger da
 * aplicação, que mascara dados pessoais; `errorFormat: "minimal"` evita que a
 * mensagem do erro carregue a consulta formatada.
 */
export function getDb(): DbClient {
  if (!globalForDb.__crmPrisma) {
    const env = getServerEnv();
    const production = env.NODE_ENV === "production";
    globalForDb.__crmPrisma = createPrismaClient(env.DATABASE_URL, {
      log: env.NODE_ENV === "development" ? ["warn", "error"] : production ? [] : ["error"],
      errorFormat: production ? "minimal" : "colorless",
    });
  }
  return globalForDb.__crmPrisma;
}
