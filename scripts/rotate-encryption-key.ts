/**
 * Rotação da chave de cifragem das observações dos pacientes.
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
import { rotateNoteEncryption } from "../src/server/maintenance/rotate-note-key";

loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production", { info: () => {}, error: console.error });

async function main() {
  const { values } = parseArgs({ options: { apply: { type: "boolean", default: false } }, strict: true });
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL não definida.");

  const current = parseEncryptionKey(process.env.DATA_ENCRYPTION_KEY);
  const previous = parseEncryptionKey(process.env.DATA_ENCRYPTION_KEY_PREVIOUS, "DATA_ENCRYPTION_KEY_PREVIOUS");
  if (current.equals(previous)) throw new Error("DATA_ENCRYPTION_KEY e DATA_ENCRYPTION_KEY_PREVIOUS são iguais.");

  const db = createPrismaClient(databaseUrl);
  try {
    const report = await rotateNoteEncryption(db, { keyring: { current, previous: [previous] }, apply: values.apply ?? false });
    console.log(`\nRotação da chave das observações — ${report.apply ? "EXECUTADA" : "simulação (use --apply para executar)"}\n`);
    console.log(`  Observações analisadas: ${report.total}`);
    console.log(`  Já na chave nova:       ${report.current}`);
    console.log(`  ${report.apply ? "Recifradas" : "Seriam recifradas"}:      ${report.reencrypted}`);
    console.log(`  Ilegíveis com as duas chaves: ${report.unreadable}${report.unreadable > 0 ? "  ← investigue antes de descartar qualquer chave" : ""}\n`);
    if (report.unreadable > 0) process.exitCode = 2;
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
