import { loadEnvConfig } from "@next/env";

import type { UserRole } from "@/generated/prisma/enums";
import { hashPassword } from "@/server/auth/password";
import { createPrismaClient, type DbClient } from "@/server/db/prisma";

loadEnvConfig(process.cwd(), true, { info: () => {}, error: console.error });

export function createTestDb(): DbClient {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL não definida.");
  return createPrismaClient(url);
}

/** Esvazia todas as tabelas (TRUNCATE não aciona o trigger da auditoria). */
export async function resetDatabase(db: DbClient): Promise<void> {
  const tables = await db.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;
  if (tables.length === 0) return;
  const list = tables.map(({ tablename }) => `"public"."${tablename}"`).join(", ");
  await db.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

let cachedHash: Promise<string> | undefined;
export const TEST_PASSWORD = "senha-de-teste-segura-123";

export async function createTestUser(
  db: DbClient,
  overrides: Partial<{ name: string; email: string; role: UserRole; isActive: boolean }> = {},
) {
  cachedHash ??= hashPassword(TEST_PASSWORD);
  return db.user.create({
    data: {
      name: overrides.name ?? "Pessoa Teste",
      email: overrides.email ?? `pessoa-${crypto.randomUUID()}@teste.test`,
      role: overrides.role ?? "RECEPTION",
      isActive: overrides.isActive ?? true,
      passwordHash: await cachedHash,
    },
  });
}
