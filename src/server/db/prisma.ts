import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient, type Prisma } from "@/generated/prisma/client";

/**
 * Fábrica do Prisma Client (Prisma 7 + driver adapter `pg`).
 *
 * Sem `server-only` de propósito: também é usada por scripts de linha de
 * comando (seed, criação de usuário) e testes. Na aplicação, use `getDb()`.
 */
export function createPrismaClient(
  connectionString: string,
  options: { log?: Prisma.LogLevel[] } = {},
) {
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter, log: options.log ?? ["error"] });
}

export type DbClient = ReturnType<typeof createPrismaClient>;

/** Cliente ou transação — permite compor operações dentro de `$transaction`. */
export type DbExecutor = DbClient | Prisma.TransactionClient;
