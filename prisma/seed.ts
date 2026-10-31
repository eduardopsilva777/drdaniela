/**
 * SEED DE DESENVOLVIMENTO — cria apenas dados FICTÍCIOS.
 *
 * - Recusa-se a rodar com NODE_ENV=production.
 * - Todos os registros usam o domínio reservado `.test` (RFC 2606) e o
 *   sobrenome "Demo", para nunca serem confundidos com dados reais.
 * - É idempotente: pode ser executado várias vezes.
 *
 * Uso: npm run db:seed
 */
import { loadEnvConfig } from "@next/env";

import type { UserRole } from "../src/generated/prisma/enums";
import { recordAudit } from "../src/server/audit";
import { hashPassword } from "../src/server/auth/password";
import { createPrismaClient } from "../src/server/db/prisma";

loadEnvConfig(process.cwd(), true, { info: () => {}, error: console.error });

const DEMO_USERS: Array<{ name: string; email: string; role: UserRole }> = [
  { name: "Helena Demo", email: "admin@demo.test", role: "ADMIN" },
  { name: "Daniela Demo", email: "profissional@demo.test", role: "PROFESSIONAL" },
  { name: "Rafaela Demo", email: "recepcao@demo.test", role: "RECEPTION" },
];

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("O seed de desenvolvimento não pode ser executado com NODE_ENV=production.");
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL não definida.");

  const password = process.env.SEED_USER_PASSWORD;
  if (!password || password.length < 12) {
    throw new Error("Defina SEED_USER_PASSWORD (mínimo de 12 caracteres) no arquivo .env.");
  }

  const db = createPrismaClient(databaseUrl);
  try {
    const passwordHash = await hashPassword(password);

    for (const demo of DEMO_USERS) {
      const existing = await db.user.findUnique({ where: { email: demo.email }, select: { id: true } });
      const user = await db.user.upsert({
        where: { email: demo.email },
        create: { ...demo, passwordHash },
        update: { name: demo.name, role: demo.role, isActive: true, passwordHash },
        select: { id: true },
      });
      if (!existing) {
        await recordAudit(db, {
          action: "user.create",
          entityType: "user",
          entityId: user.id,
          metadata: { source: "seed", role: demo.role },
        });
      }
    }

    console.log("\nSeed concluído — usuários FICTÍCIOS de desenvolvimento:\n");
    for (const demo of DEMO_USERS) {
      console.log(`  ${demo.role.padEnd(13)} ${demo.email}`);
    }
    console.log("\n  Senha: valor de SEED_USER_PASSWORD no seu .env\n");
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
