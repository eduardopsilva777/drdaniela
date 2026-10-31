/**
 * Gestão de contas da equipe pela linha de comando (válido também em produção).
 * Até a etapa 8 (gestão de usuários na interface), é assim que contas são
 * criadas e senhas redefinidas. Toda operação é registrada na auditoria.
 *
 * Criar conta:
 *   npm run user:create -- --email maria@clinica.com.br --name "Maria Souza" --role RECEPTION
 *
 * Redefinir senha (encerra todas as sessões abertas da pessoa):
 *   npm run user:reset-password -- --email maria@clinica.com.br
 *
 * A senha é digitada sem eco no terminal. Em automações, pode ser enviada
 * pela variável USER_PASSWORD (evite deixá-la no histórico do shell).
 */
import { parseArgs } from "node:util";

import { loadEnvConfig } from "@next/env";
import { z } from "zod";

import { emailSchema, newPasswordSchema } from "../src/lib/validation/auth";
import { recordAudit } from "../src/server/audit";
import { hashPassword } from "../src/server/auth/password";
import { invalidateUserSessions } from "../src/server/auth/session-store";
import { createPrismaClient } from "../src/server/db/prisma";

loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production", {
  info: () => {},
  error: console.error,
});

const ROLES = ["ADMIN", "PROFESSIONAL", "RECEPTION"] as const;

function fail(message: string): never {
  console.error(`\nErro: ${message}\n`);
  process.exit(1);
}

function readHidden(question: string): Promise<string> {
  const stdin = process.stdin;
  if (!stdin.isTTY) {
    fail("Terminal não interativo: informe a senha pela variável USER_PASSWORD.");
  }
  return new Promise((resolve) => {
    let value = "";
    process.stdout.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === "\r" || char === "\n") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off("data", onData);
          process.stdout.write("\n");
          resolve(value);
          return;
        }
        if (char === "\u0003") {
          process.stdout.write("\n");
          process.exit(130);
        }
        if (char === "\u007f" || char === "\b") {
          value = value.slice(0, -1);
          continue;
        }
        value += char;
      }
    };
    stdin.on("data", onData);
  });
}

async function obtainPassword(): Promise<string> {
  const fromEnv = process.env.USER_PASSWORD;
  const password = fromEnv ?? (await readHidden("Nova senha: "));
  const parsed = newPasswordSchema.safeParse(password);
  if (!parsed.success) fail(parsed.error.issues.map((issue) => issue.message).join(" "));
  if (!fromEnv) {
    const confirmation = await readHidden("Repita a senha: ");
    if (confirmation !== password) fail("As senhas não conferem.");
  }
  return password;
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const { values } = parseArgs({
    args: rest,
    options: {
      email: { type: "string" },
      name: { type: "string" },
      role: { type: "string" },
    },
    strict: true,
  });

  const email = emailSchema.safeParse(values.email ?? "");
  if (!email.success) fail("Informe um e-mail válido com --email.");

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) fail("DATABASE_URL não definida.");
  const db = createPrismaClient(databaseUrl);

  try {
    if (command === "create") {
      const name = z.string().trim().min(2).max(120).safeParse(values.name ?? "");
      if (!name.success) fail('Informe o nome completo com --name "Nome Sobrenome".');
      const role = z.enum(ROLES).safeParse(values.role ?? "");
      if (!role.success) fail(`Informe o perfil com --role (${ROLES.join(", ")}).`);

      const exists = await db.user.findUnique({ where: { email: email.data }, select: { id: true } });
      if (exists) fail("Já existe uma conta com este e-mail. Use user:reset-password para redefinir a senha.");

      const passwordHash = await hashPassword(await obtainPassword());
      const user = await db.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: { email: email.data, name: name.data, role: role.data, passwordHash },
          select: { id: true },
        });
        await recordAudit(tx, {
          action: "user.create",
          entityType: "user",
          entityId: created.id,
          metadata: { source: "cli", role: role.data },
        });
        return created;
      });
      console.log(`\nConta criada (${role.data}) para ${email.data}. ID: ${user.id}\n`);
      return;
    }

    if (command === "reset-password") {
      const user = await db.user.findUnique({ where: { email: email.data }, select: { id: true } });
      if (!user) fail("Nenhuma conta encontrada com este e-mail.");

      const passwordHash = await hashPassword(await obtainPassword());
      const closedSessions = await db.$transaction(async (tx) => {
        await tx.user.update({
          where: { id: user.id },
          data: { passwordHash, passwordChangedAt: new Date() },
        });
        const count = await invalidateUserSessions(tx, user.id);
        await recordAudit(tx, {
          action: "user.password.reset",
          entityType: "user",
          entityId: user.id,
          metadata: { source: "cli", closedSessions: count },
        });
        return count;
      });
      console.log(`\nSenha redefinida. Sessões encerradas: ${closedSessions}.\n`);
      return;
    }

    fail('Comando desconhecido. Use "create" ou "reset-password".');
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  fail(error instanceof Error ? error.message : String(error));
});
