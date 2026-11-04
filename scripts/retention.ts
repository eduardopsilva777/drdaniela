/**
 * Rotina de retenção de dados técnicos (sessões expiradas, tentativas de login
 * e eventos de webhook antigos). Por padrão apenas SIMULA e mostra o que seria
 * apagado; com --apply executa e registra na auditoria.
 *
 *   npm run data:retention              # simulação
 *   npm run data:retention -- --apply   # executa
 *
 * Não apaga dados de pacientes, leads, agenda nem a trilha de auditoria.
 */
import { parseArgs } from "node:util";

import { loadEnvConfig } from "@next/env";

import { createPrismaClient } from "../src/server/db/prisma";
import { RETENTION_POLICY, runRetention } from "../src/server/maintenance/retention";

loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production", { info: () => {}, error: console.error });

async function main() {
  const { values } = parseArgs({ options: { apply: { type: "boolean", default: false } }, strict: true });
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL não definida.");

  const db = createPrismaClient(databaseUrl);
  try {
    const report = await runRetention(db, { apply: values.apply ?? false });
    const verb = report.apply ? "Apagados" : "Seriam apagados";
    console.log(`\nRetenção de dados técnicos — ${report.apply ? "EXECUTADA" : "simulação (use --apply para executar)"}\n`);
    console.log(`  ${verb}: ${report.expiredSessions} sessão(ões) expirada(s)`);
    console.log(`  ${verb}: ${report.loginAttempts} tentativa(s) de login com mais de ${RETENTION_POLICY.loginAttemptsDays} dias`);
    console.log(`  ${verb}: ${report.webhookEvents} evento(s) de webhook com mais de ${RETENTION_POLICY.webhookEventsDays} dias\n`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
