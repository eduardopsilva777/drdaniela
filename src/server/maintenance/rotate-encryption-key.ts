import { recordAudit } from "@/server/audit";
import { isSealed, KNOWLEDGE_GAP_CONTEXT, memoryContext, messageContext } from "@/server/crypto/content-cipher";
import {
  decryptWithKeyring,
  encryptField,
  noteContext,
  type Keyring,
} from "@/server/crypto/field-encryption";
import type { DbClient } from "@/server/db/prisma";

/**
 * Recifra com a chave atual TUDO o que a DATA_ENCRYPTION_KEY protege (rotação
 * da chave): observações dos pacientes, textos das mensagens do WhatsApp,
 * notas do assistente sobre as conversas e perguntas guardadas para curadoria.
 * Por padrão apenas simula; com `apply` grava.
 * Procedimento completo em docs/operacao.md.
 *
 * Textos gravados sem cifragem (antes de a chave existir) e mensagens apagadas
 * não são tocados. Registros que nenhuma chave consegue ler são preservados
 * intactos e contados como ilegíveis.
 *
 * Sem `server-only`: executada pela linha de comando (`npm run data:rotate-key`).
 */

export interface RotationCounts {
  /** Registros cifrados analisados. */
  total: number;
  /** Já cifrados com a chave atual. */
  current: number;
  /** Cifrados com a chave anterior (recifrados quando `apply`). */
  reencrypted: number;
  /** Nenhuma chave disponível consegue ler — exigem investigação (backup da chave antiga?). */
  unreadable: number;
}

export interface RotationReport extends RotationCounts {
  apply: boolean;
  /** Os totais acima, separados por tipo de conteúdo. */
  byKind: {
    notes: RotationCounts;
    messages: RotationCounts;
    assistantMemories: RotationCounts;
    knowledgeGaps: RotationCounts;
  };
}

interface StoredRow {
  id: string;
  /** Conteúdo gravado: cifrado ("v1:…"), texto puro antigo ou nulo (apagado). */
  value: string | null;
  context: string;
}

const emptyCounts = (): RotationCounts => ({ total: 0, current: 0, reencrypted: 0, unreadable: 0 });

/**
 * Percorre os registros em lotes (cursor pelo id) e recifra os que usam a chave
 * anterior. `onlySealed`: ignora (sem contar) textos puros e nulos — as
 * observações, sempre cifradas, são todas contadas.
 */
async function rotateRows(
  fetchBatch: (cursor: string | undefined, take: number) => Promise<StoredRow[]>,
  update: (row: StoredRow & { value: string }, value: string) => Promise<void>,
  options: { keyring: Keyring; apply: boolean; batchSize: number; onlySealed: boolean },
): Promise<RotationCounts> {
  const counts = emptyCounts();
  let cursor: string | undefined;
  for (;;) {
    const rows = await fetchBatch(cursor, options.batchSize);
    if (rows.length === 0) break;
    // O cursor avança pelas linhas lidas, mesmo as ignoradas.
    cursor = rows.at(-1)!.id;
    for (const stored of rows) {
      if (stored.value === null || (options.onlySealed && !isSealed(stored.value))) continue;
      const row = { ...stored, value: stored.value };
      counts.total += 1;
      let decrypted: { plaintext: string; usedPrevious: boolean };
      try {
        decrypted = decryptWithKeyring(row.value, options.keyring, row.context);
      } catch {
        counts.unreadable += 1;
        continue;
      }
      if (!decrypted.usedPrevious) {
        counts.current += 1;
        continue;
      }
      counts.reencrypted += 1;
      if (options.apply) await update(row, encryptField(decrypted.plaintext, options.keyring.current, row.context));
    }
  }
  return counts;
}

const page = (cursor: string | undefined, take: number) => ({
  orderBy: { id: "asc" as const },
  take,
  ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
});

export async function rotateDataEncryption(
  db: DbClient,
  options: { keyring: Keyring; apply: boolean; batchSize?: number },
): Promise<RotationReport> {
  const base = { keyring: options.keyring, apply: options.apply, batchSize: options.batchSize ?? 200 };

  // Observações: sempre cifradas. Atualização condicional: não sobrescreve uma nota alterada no meio da rotação.
  const notes = await rotateRows(
    async (cursor, take) =>
      (await db.patientNote.findMany({ ...page(cursor, take), select: { id: true, patientId: true, content: true } })).map(
        (note) => ({ id: note.id, value: note.content, context: noteContext(note.patientId) }),
      ),
    async (row, value) => {
      await db.patientNote.updateMany({ where: { id: row.id, content: row.value }, data: { content: value } });
    },
    { ...base, onlySealed: false },
  );

  // Mensagens do WhatsApp: só as cifradas (as antigas, sem chave, ficam como estão; apagadas não têm texto).
  const messages = await rotateRows(
    async (cursor, take) =>
      (
        await db.whatsAppMessage.findMany({
          ...page(cursor, take),
          where: { body: { startsWith: "v1:" } },
          select: { id: true, conversationId: true, body: true },
        })
      ).map((message) => ({ id: message.id, value: message.body, context: messageContext(message.conversationId) })),
    async (row, value) => {
      await db.whatsAppMessage.updateMany({ where: { id: row.id, body: row.value }, data: { body: value } });
    },
    { ...base, onlySealed: true },
  );

  // Notas do assistente sobre as conversas (cifradas quando havia chave).
  const assistantMemories = await rotateRows(
    async (cursor, take) =>
      (
        await db.whatsAppConversation.findMany({
          ...page(cursor, take),
          where: { assistantMemory: { startsWith: "v1:" } },
          select: { id: true, assistantMemory: true },
        })
      ).map((conversation) => ({ id: conversation.id, value: conversation.assistantMemory, context: memoryContext(conversation.id) })),
    async (row, value) => {
      await db.whatsAppConversation.updateMany({ where: { id: row.id, assistantMemory: row.value }, data: { assistantMemory: value } });
    },
    { ...base, onlySealed: true },
  );

  // Perguntas de curadoria (já mascaradas; cifradas quando havia chave).
  const knowledgeGaps = await rotateRows(
    async (cursor, take) =>
      (
        await db.knowledgeGap.findMany({
          ...page(cursor, take),
          where: { question: { startsWith: "v1:" } },
          select: { id: true, question: true },
        })
      ).map((gap) => ({ id: gap.id, value: gap.question, context: KNOWLEDGE_GAP_CONTEXT })),
    async (row, value) => {
      await db.knowledgeGap.updateMany({ where: { id: row.id, question: row.value }, data: { question: value } });
    },
    { ...base, onlySealed: true },
  );

  const report: RotationReport = {
    apply: options.apply,
    total: notes.total + messages.total + assistantMemories.total + knowledgeGaps.total,
    current: notes.current + messages.current + assistantMemories.current + knowledgeGaps.current,
    reencrypted: notes.reencrypted + messages.reencrypted + assistantMemories.reencrypted + knowledgeGaps.reencrypted,
    unreadable: notes.unreadable + messages.unreadable + assistantMemories.unreadable + knowledgeGaps.unreadable,
    byKind: { notes, messages, assistantMemories, knowledgeGaps },
  };

  if (options.apply) {
    await recordAudit(db, {
      action: "data.encryption.rotate",
      // Nomes de chave neutros: a redação da auditoria apagaria valores em chaves como "notes"/"body".
      metadata: {
        source: "cli",
        total: report.total,
        reencrypted: report.reencrypted,
        unreadable: report.unreadable,
        patientRecords: notes.reencrypted,
        whatsappMessages: messages.reencrypted,
        assistantMemories: assistantMemories.reencrypted,
        curationQuestions: knowledgeGaps.reencrypted,
      },
    });
  }
  return report;
}
