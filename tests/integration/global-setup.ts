import { execSync } from "node:child_process";

import { loadEnvConfig } from "@next/env";

/**
 * Prepara o banco de TESTES: valida que ele é diferente do banco de
 * desenvolvimento (os testes apagam dados) e aplica todas as migrations.
 */
export default function setup() {
  loadEnvConfig(process.cwd(), true, { info: () => {}, error: console.error });

  const testUrl = process.env.TEST_DATABASE_URL;
  if (!testUrl) {
    throw new Error(
      "TEST_DATABASE_URL não definida. Configure-a no .env (veja .env.example) e rode `npm run db:up`.",
    );
  }
  if (testUrl === process.env.DATABASE_URL) {
    throw new Error("TEST_DATABASE_URL deve apontar para um banco diferente de DATABASE_URL.");
  }

  process.env.DATABASE_URL = testUrl;
  execSync("npx prisma migrate deploy", {
    stdio: "pipe",
    env: { ...process.env, DATABASE_URL: testUrl },
  });
}
