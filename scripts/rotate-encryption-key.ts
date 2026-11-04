/**
 * Rotação da DATA_ENCRYPTION_KEY: recifra observações dos pacientes, mensagens
 * do WhatsApp, notas do assistente e perguntas de curadoria (tudo o que essa
 * chave protege).
 *
 * Pré-requisito: DATA_ENCRYPTION_KEY = chave NOVA e DATA_ENCRYPTION_KEY_PREVIOUS
 * = chave ANTIGA (no ambiente em que o script roda). Por padrão apenas SIMULA.
 *
 *   npm run data:rotate-key              # simulação: conta o que seria recifrado
 *   npm run data:rotate-key -- --apply   # recifra e registra na auditoria
 *
 * Procedimento completo (inclui backups antigos): docs/operacao.md.
 */
import { parseArgs } from "node:util";

import { loadEnvConfig } from "@next/env";

import { parseEncryptionKey } from "../src/server/crypto/field-encryption";
import { createPrismaClient } from "../src/server/db/prisma";
import { rotateDataEncryption, type RotationCounts } from "../src/server/maintenance/rotate-encryption-key";

loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production", { info: () => {}, error: console.error });

function describe(label: string, counts: RotationCounts, apply: boolean): string {
  return [
    `  ${label}: ${counts.total} cifrada(s)`,
    `    já na chave nova: ${counts.current}`,
    `    ${apply ? "recifradas" : "seriam recifradas"}: ${counts.reencrypted}`,
    `    ilegíveis com as duas chaves: ${counts.unreadable}${counts.unreadable > 0 ? "  ← investigue antes de descartar qualquer chave" : ""}`,
  ].join("\n");
}

async function main() {
  const { values } = parseArgs({ options: { apply: { type: "boolean", default: false } }, strict: true });
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL não definida.");

  const current = parseEncryptionKey(process.env.DATA_ENCRYPTION_KEY);
  const previous = parseEncryptionKey(process.env.DATA_ENCRYPTION_KEY_PREVIOUS, "DATA_ENCRYPTION_KEY_PREVIOUS");
  if (current.equals(previous)) throw new Error("DATA_ENCRYPTION_KEY e DATA_ENCRYPTION_KEY_PREVIOUS são iguais.");

  const db = createPrismaClient(databaseUrl);
  try {
    const report = await rotateDataEncryption(db, { keyring: { current, previous: [previous] }, apply: values.apply ?? false });
    console.log(`\nRotação da DATA_ENCRYPTION_KEY — ${report.apply ? "EXECUTADA" : "simulação (use --apply para executar)"}\n`);
    console.log(describe("Observações dos pacientes", report.byKind.notes, report.apply));
    console.log(describe("Mensagens do WhatsApp", report.byKind.messages, report.apply));
    console.log(describe("Notas do assistente", report.byKind.assistantMemories, report.apply));
    console.log(describe("Perguntas de curadoria", report.byKind.knowledgeGaps, report.apply));
    console.log(
      `\n  Total: ${report.total} cifrado(s), ${report.reencrypted} ${report.apply ? "recifrado(s)" : "a recifrar"}, ${report.unreadable} ilegível(is)\n`,
    );
    if (report.unreadable > 0) process.exitCode = 2;
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
