import { recordAudit } from "@/server/audit";
import {
  decryptWithKeyring,
  encryptField,
  noteContext,
  type Keyring,
} from "@/server/crypto/field-encryption";
import type { DbClient } from "@/server/db/prisma";

/**
 * Recifra as observações dos pacientes com a chave atual (rotação da
 * DATA_ENCRYPTION_KEY). Por padrão apenas simula; com `apply` grava.
 * Procedimento completo em docs/operacao.md.
 *
 * Sem `server-only`: executada pela linha de comando (`npm run data:rotate-key`).
 */

export interface RotationReport {
  apply: boolean;
  total: number;
  /** Já cifradas com a chave atual. */
  current: number;
  /** Cifradas com a chave anterior (recifradas quando `apply`). */
  reencrypted: number;
  /** Nenhuma chave disponível consegue ler — exigem investigação (backup da chave antiga?). */
  unreadable: number;
}

export async function rotateNoteEncryption(
  db: DbClient,
  options: { keyring: Keyring; apply: boolean; batchSize?: number },
): Promise<RotationReport> {
  const report: RotationReport = { apply: options.apply, total: 0, current: 0, reencrypted: 0, unreadable: 0 };
  const batchSize = options.batchSize ?? 200;
  let cursor: string | undefined;

  for (;;) {
    const notes = await db.patientNote.findMany({
      orderBy: { id: "asc" },
      take: batchSize,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      select: { id: true, patientId: true, content: true },
    });
    if (notes.length === 0) break;

    for (const note of notes) {
      report.total += 1;
      const context = noteContext(note.patientId);
      let decrypted: { plaintext: string; usedPrevious: boolean };
      try {
        decrypted = decryptWithKeyring(note.content, options.keyring, context);
      } catch {
        report.unreadable += 1;
        continue;
      }
      if (!decrypted.usedPrevious) {
        report.current += 1;
        continue;
      }
      report.reencrypted += 1;
      if (options.apply) {
        // Atualização condicional: não sobrescreve uma nota alterada no meio da rotação.
        await db.patientNote.updateMany({
          where: { id: note.id, content: note.content },
          data: { content: encryptField(decrypted.plaintext, options.keyring.current, context) },
        });
      }
    }
    cursor = notes.at(-1)!.id;
  }

  if (options.apply) {
    await recordAudit(db, {
      action: "data.encryption.rotate",
      metadata: {
        source: "cli",
        total: report.total,
        reencrypted: report.reencrypted,
        unreadable: report.unreadable,
      },
    });
  }
  return report;
}
