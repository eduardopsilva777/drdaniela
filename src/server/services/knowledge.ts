import "server-only";

import type { KnowledgeGapReason } from "@/generated/prisma/enums";
import type { KnowledgeEntryInput } from "@/lib/validation/assistant";
import { rankPassages } from "@/server/assistant/knowledge-search";
import type { Intent, KnowledgePassage } from "@/server/assistant/types";
import { recordAudit } from "@/server/audit";
import { KNOWLEDGE_GAP_CONTEXT, messageContext, openText, sealText } from "@/server/crypto/content-cipher";
import type { Keyring } from "@/server/crypto/field-encryption";
import type { DbClient, DbExecutor } from "@/server/db/prisma";
import { DomainError, NotFoundError } from "@/server/errors";
import { maskSensitiveText } from "@/server/logging/redact";

import { assertPermission, auditContext, type Actor } from "./context";

/**
 * Base de conhecimento do assistente, com curadoria humana:
 * - Cada alteração é uma nova VERSÃO (autor, data, motivo). O assistente usa só
 *   a versão APROVADA publicada; rascunhos e versões em revisão não chegam aos contatos.
 * - Aprovar exige `knowledge:approve` (profissional ou administração).
 * - Perguntas sem resposta e respostas mal avaliadas viram pendências para a
 *   equipe transformar em conteúdo aprovado. Nada disso treina modelos: o
 *   assistente apenas consulta o que foi aprovado (recuperação, RAG).
 */

// -----------------------------------------------------------------------------
// Leitura para o assistente
// -----------------------------------------------------------------------------

export async function loadPublishedPassages(db: DbExecutor): Promise<KnowledgePassage[]> {
  const entries = await db.knowledgeEntry.findMany({
    where: { isArchived: false, publishedVersionId: { not: null } },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      category: true,
      procedure: { select: { name: true } },
      publishedVersion: { select: { title: true, content: true, keywords: true } },
    },
  });
  return entries.flatMap((entry) =>
    entry.publishedVersion
      ? [
          {
            id: entry.id,
            title: entry.publishedVersion.title,
            content: entry.publishedVersion.content,
            keywords: entry.publishedVersion.keywords,
            category: entry.category,
            procedureName: entry.procedure?.name ?? null,
          },
        ]
      : [],
  );
}

/** Base pequena: o motor recebe todas as entradas (as mais relevantes primeiro). */
const SEND_ALL_UP_TO = 12;
const MAX_PASSAGES = 8;

/** Entradas aprovadas mais relevantes para a pergunta (recuperação lexical). */
export function selectPassages(query: string, passages: KnowledgePassage[], intent?: Intent): KnowledgePassage[] {
  const ranked = rankPassages(query, passages, intent).map((item) => item.passage);
  if (passages.length <= SEND_ALL_UP_TO) {
    const rest = passages.filter((passage) => !ranked.includes(passage));
    return [...ranked, ...rest];
  }
  return ranked.slice(0, MAX_PASSAGES);
}

// -----------------------------------------------------------------------------
// Curadoria: entradas e versões
// -----------------------------------------------------------------------------

async function assertProcedure(db: DbExecutor, procedureId: string | undefined) {
  if (!procedureId) return;
  const procedure = await db.procedure.findUnique({ where: { id: procedureId }, select: { id: true } });
  if (!procedure) throw new DomainError("Procedimento inválido.", { fieldErrors: { procedureId: ["Selecione um procedimento válido."] } });
}

export async function createKnowledgeEntry(db: DbClient, actor: Actor, input: KnowledgeEntryInput) {
  assertPermission(actor, "knowledge:write");
  await assertProcedure(db, input.procedureId);
  return db.$transaction(async (tx) => {
    const entry = await tx.knowledgeEntry.create({
      data: { category: input.category, procedureId: input.procedureId ?? null },
    });
    const version = await tx.knowledgeEntryVersion.create({
      data: {
        entryId: entry.id,
        version: 1,
        title: input.title,
        content: input.content,
        keywords: input.keywords,
        changeNote: input.changeNote ?? null,
        status: input.submit ? "IN_REVIEW" : "DRAFT",
        authorId: actor.id,
      },
    });
    if (input.gapId) {
      await tx.knowledgeGap.updateMany({ where: { id: input.gapId, status: "OPEN" }, data: { resolvedEntryId: entry.id } });
    }
    await recordAudit(tx, {
      ...auditContext(actor),
      action: "knowledge.entry.create",
      entityType: "knowledge_entry",
      entityId: entry.id,
      metadata: { category: input.category, submitted: input.submit },
    });
    return { entryId: entry.id, versionId: version.id };
  });
}

/** Nova versão de uma entrada. Rascunhos/revisões anteriores ainda não aprovados são substituídos. */
export async function createKnowledgeVersion(db: DbClient, actor: Actor, entryId: string, input: KnowledgeEntryInput) {
  assertPermission(actor, "knowledge:write");
  await assertProcedure(db, input.procedureId);
  return db.$transaction(async (tx) => {
    const entry = await tx.knowledgeEntry.findUnique({ where: { id: entryId }, select: { id: true, isArchived: true } });
    if (!entry) throw new NotFoundError("Entrada");
    if (entry.isArchived) throw new DomainError("Restaure a entrada antes de editá-la.");
    const last = await tx.knowledgeEntryVersion.findFirst({ where: { entryId }, orderBy: { version: "desc" }, select: { version: true } });
    await tx.knowledgeEntryVersion.updateMany({
      where: { entryId, status: { in: ["DRAFT", "IN_REVIEW"] } },
      data: { status: "SUPERSEDED" },
    });
    const version = await tx.knowledgeEntryVersion.create({
      data: {
        entryId,
        version: (last?.version ?? 0) + 1,
        title: input.title,
        content: input.content,
        keywords: input.keywords,
        changeNote: input.changeNote ?? null,
        status: input.submit ? "IN_REVIEW" : "DRAFT",
        authorId: actor.id,
      },
    });
    // Categoria e procedimento são dados de organização (não mudam o texto publicado).
    await tx.knowledgeEntry.update({ where: { id: entryId }, data: { category: input.category, procedureId: input.procedureId ?? null } });
    if (input.gapId) {
      await tx.knowledgeGap.updateMany({ where: { id: input.gapId, status: "OPEN" }, data: { resolvedEntryId: entryId } });
    }
    await recordAudit(tx, {
      ...auditContext(actor),
      action: "knowledge.version.create",
      entityType: "knowledge_entry",
      entityId: entryId,
      metadata: { version: version.version, submitted: input.submit },
    });
    return { entryId, versionId: version.id };
  });
}

export async function submitKnowledgeVersion(db: DbClient, actor: Actor, versionId: string) {
  assertPermission(actor, "knowledge:write");
  return db.$transaction(async (tx) => {
    const updated = await tx.knowledgeEntryVersion.updateMany({ where: { id: versionId, status: "DRAFT" }, data: { status: "IN_REVIEW" } });
    if (updated.count === 0) throw new DomainError("Só rascunhos podem ser enviados para aprovação.");
    const version = await tx.knowledgeEntryVersion.findUniqueOrThrow({ where: { id: versionId }, select: { entryId: true } });
    await recordAudit(tx, { ...auditContext(actor), action: "knowledge.version.submit", entityType: "knowledge_entry", entityId: version.entryId });
  });
}

/** Aprova e publica: a partir de agora o assistente usa esta versão. */
export async function approveKnowledgeVersion(db: DbClient, actor: Actor, versionId: string, note?: string, now: Date = new Date()) {
  assertPermission(actor, "knowledge:approve");
  return db.$transaction(async (tx) => {
    const version = await tx.knowledgeEntryVersion.findUnique({
      where: { id: versionId },
      select: { id: true, entryId: true, status: true, version: true, entry: { select: { isArchived: true, publishedVersionId: true } } },
    });
    if (!version) throw new NotFoundError("Versão");
    if (version.status !== "DRAFT" && version.status !== "IN_REVIEW") {
      throw new DomainError("Esta versão já foi revisada.");
    }
    if (version.entry.isArchived) throw new DomainError("Restaure a entrada antes de publicar.");

    await tx.knowledgeEntryVersion.update({
      where: { id: versionId },
      data: { status: "APPROVED", reviewedById: actor.id, reviewedAt: now, reviewNote: note ?? null },
    });
    if (version.entry.publishedVersionId) {
      await tx.knowledgeEntryVersion.update({ where: { id: version.entry.publishedVersionId }, data: { status: "SUPERSEDED" } });
    }
    await tx.knowledgeEntry.update({ where: { id: version.entryId }, data: { publishedVersionId: versionId } });
    const resolved = await tx.knowledgeGap.updateMany({
      where: { resolvedEntryId: version.entryId, status: "OPEN" },
      data: { status: "RESOLVED", resolvedById: actor.id, resolvedAt: now },
    });
    await recordAudit(tx, {
      ...auditContext(actor),
      action: "knowledge.version.approve",
      entityType: "knowledge_entry",
      entityId: version.entryId,
      metadata: { version: version.version, gapsResolved: resolved.count },
    });
  });
}

export async function rejectKnowledgeVersion(db: DbClient, actor: Actor, versionId: string, note: string, now: Date = new Date()) {
  assertPermission(actor, "knowledge:approve");
  return db.$transaction(async (tx) => {
    const updated = await tx.knowledgeEntryVersion.updateMany({
      where: { id: versionId, status: { in: ["DRAFT", "IN_REVIEW"] } },
      data: { status: "REJECTED", reviewedById: actor.id, reviewedAt: now, reviewNote: note },
    });
    if (updated.count === 0) throw new DomainError("Esta versão já foi revisada.");
    const version = await tx.knowledgeEntryVersion.findUniqueOrThrow({ where: { id: versionId }, select: { entryId: true, version: true } });
    await recordAudit(tx, {
      ...auditContext(actor),
      action: "knowledge.version.reject",
      entityType: "knowledge_entry",
      entityId: version.entryId,
      metadata: { version: version.version },
    });
  });
}

/** Arquivar tira a entrada do assistente na hora (o histórico de versões é mantido). */
export async function setKnowledgeEntryArchived(db: DbClient, actor: Actor, entryId: string, archived: boolean) {
  assertPermission(actor, "knowledge:approve");
  return db.$transaction(async (tx) => {
    const updated = await tx.knowledgeEntry.updateMany({ where: { id: entryId, isArchived: !archived }, data: { isArchived: archived } });
    if (updated.count === 0) {
      const exists = await tx.knowledgeEntry.findUnique({ where: { id: entryId }, select: { id: true } });
      if (!exists) throw new NotFoundError("Entrada");
      return;
    }
    await recordAudit(tx, {
      ...auditContext(actor),
      action: archived ? "knowledge.entry.archive" : "knowledge.entry.restore",
      entityType: "knowledge_entry",
      entityId: entryId,
    });
  });
}

// -----------------------------------------------------------------------------
// Pendências de curadoria (perguntas sem resposta, respostas mal avaliadas)
// -----------------------------------------------------------------------------

export async function recordKnowledgeGap(
  db: DbExecutor,
  keyring: Keyring | null,
  input: {
    question: string;
    reason: KnowledgeGapReason;
    conversationId?: string | null;
    messageId?: string | null;
    reportedById?: string | null;
    feedbackNote?: string | null;
  },
): Promise<{ created: boolean }> {
  // A pergunta é guardada mascarada (sem telefone, e-mail, CPF) e cifrada quando há chave.
  const question = maskSensitiveText(input.question).trim().slice(0, 1000);
  if (!question) return { created: false };
  const result = await db.knowledgeGap.createMany({
    data: [
      {
        question: sealText(question, KNOWLEDGE_GAP_CONTEXT, keyring),
        reason: input.reason,
        conversationId: input.conversationId ?? null,
        messageId: input.messageId ?? null,
        reportedById: input.reportedById ?? null,
        feedbackNote: input.feedbackNote ? maskSensitiveText(input.feedbackNote).slice(0, 300) : null,
      },
    ],
    skipDuplicates: true,
  });
  return { created: result.count === 1 };
}

/** A equipe avalia negativamente uma resposta do assistente (vira pendência de curadoria). */
export async function reportAssistantReply(
  db: DbClient,
  actor: Actor,
  keyring: Keyring | null,
  messageId: string,
  note?: string,
) {
  assertPermission(actor, "knowledge:write");
  const message = await db.whatsAppMessage.findUnique({
    where: { id: messageId },
    select: {
      id: true,
      origin: true,
      conversationId: true,
      replyOfRun: { select: { inboundMessage: { select: { body: true } } } },
    },
  });
  if (!message || message.origin !== "ASSISTANT") throw new DomainError("Só respostas do assistente podem ser avaliadas.");
  const inbound = message.replyOfRun?.inboundMessage?.body ?? null;
  const question = openText(inbound, messageContext(message.conversationId), keyring) ?? "(pergunta indisponível)";
  const { created } = await recordKnowledgeGap(db, keyring, {
    question,
    reason: "NEGATIVE_FEEDBACK",
    conversationId: message.conversationId,
    messageId: message.id,
    reportedById: actor.id,
    feedbackNote: note ?? null,
  });
  await recordAudit(db, {
    ...auditContext(actor),
    action: "knowledge.gap.report",
    entityType: "whatsapp_message",
    entityId: message.id,
    metadata: { duplicate: !created },
  });
  return { created };
}

export async function dismissKnowledgeGap(db: DbClient, actor: Actor, gapId: string, now: Date = new Date()) {
  assertPermission(actor, "knowledge:write");
  return db.$transaction(async (tx) => {
    const updated = await tx.knowledgeGap.updateMany({
      where: { id: gapId, status: "OPEN" },
      data: { status: "DISMISSED", resolvedById: actor.id, resolvedAt: now },
    });
    if (updated.count === 0) throw new DomainError("Esta pendência já foi tratada.");
    await recordAudit(tx, { ...auditContext(actor), action: "knowledge.gap.dismiss", entityType: "knowledge_gap", entityId: gapId });
  });
}

/** Pergunta da pendência, decifrada para a equipe (com permissão de curadoria). */
export function readGapQuestion(stored: string, keyring: Keyring | null): string {
  return openText(stored, KNOWLEDGE_GAP_CONTEXT, keyring) ?? "";
}

/** Rascunhos e versões em revisão (mais recentes de cada entrada), para o teste antes de publicar. */
export async function loadDraftPassages(db: DbExecutor): Promise<KnowledgePassage[]> {
  const versions = await db.knowledgeEntryVersion.findMany({
    where: { status: { in: ["DRAFT", "IN_REVIEW"] }, entry: { isArchived: false } },
    orderBy: { version: "desc" },
    select: {
      entryId: true,
      title: true,
      content: true,
      keywords: true,
      entry: { select: { category: true, procedure: { select: { name: true } } } },
    },
  });
  const seen = new Set<string>();
  const passages: KnowledgePassage[] = [];
  for (const version of versions) {
    if (seen.has(version.entryId)) continue;
    seen.add(version.entryId);
    passages.push({
      id: version.entryId,
      title: version.title,
      content: version.content,
      keywords: version.keywords,
      category: version.entry.category,
      procedureName: version.entry.procedure?.name ?? null,
    });
  }
  return passages;
}
