import "server-only";

import { getServerEnv } from "@/server/env";

import { createPrismaClient, type DbClient } from "./prisma";

export type { DbClient, DbExecutor } from "./prisma";

const globalForDb = globalThis as unknown as { __crmPrisma?: DbClient };

/**
 * Instância única do Prisma Client por processo (reutilizada entre recargas
 * do servidor de desenvolvimento para não esgotar conexões).
 */
export function getDb(): DbClient {
  if (!globalForDb.__crmPrisma) {
    const env = getServerEnv();
    globalForDb.__crmPrisma = createPrismaClient(env.DATABASE_URL, {
      log: env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
    });
  }
  return globalForDb.__crmPrisma;
}
