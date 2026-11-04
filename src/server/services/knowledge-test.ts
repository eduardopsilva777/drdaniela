import "server-only";

import { formatKeyDate, formatKeyWeekdayLong, todayKey } from "@/lib/datetime";
import { checkGroundedAnswer } from "@/server/assistant/guard";
import type { AssistantModel, Intent } from "@/server/assistant/types";
import { recordAudit } from "@/server/audit";
import type { DbClient } from "@/server/db/prisma";
import { maskSensitiveText } from "@/server/logging/redact";

import { getAssistantConfig } from "./assistant-settings";
import { assertPermission, auditContext, type Actor } from "./context";
import { loadDraftPassages, loadPublishedPassages, selectPassages } from "./knowledge";

export interface KnowledgeTestResult {
  engine: string;
  intent: Intent;
  answer: string | null;
  /** Motivo do bloqueio pela checagem de segurança (ex.: preço sem fonte). */
  blockedReason: string | null;
  sources: Array<{ id: string; title: string }>;
  considered: number;
  clinical: boolean;
  urgent: boolean;
  wantsHuman: boolean;
}

/**
 * Teste de perguntas antes de publicar: roda o mesmo motor e a mesma checagem
 * do atendimento, sem enviar mensagem nem gravar conversa. Com `includeDrafts`,
 * rascunhos e versões em revisão substituem a versão publicada da mesma entrada.
 */
export async function testKnowledgeQuestion(
  db: DbClient,
  actor: Actor,
  model: AssistantModel,
  input: { question: string; includeDrafts: boolean },
  options: { timeZone: string; now?: Date },
): Promise<KnowledgeTestResult> {
  assertPermission(actor, "knowledge:write");
  const now = options.now ?? new Date();
  const config = await getAssistantConfig(db);
  const published = await loadPublishedPassages(db);
  let passages = published;
  if (input.includeDrafts) {
    const drafts = await loadDraftPassages(db);
    const draftIds = new Set(drafts.map((draft) => draft.id));
    passages = [...published.filter((passage) => !draftIds.has(passage.id)), ...drafts];
  }
  const question = maskSensitiveText(input.question).slice(0, 500);
  const selected = selectPassages(question, passages);
  const today = todayKey(options.timeZone, now);
  const interpretation = await model.interpret({
    text: question,
    history: [],
    passages: selected,
    expecting: null,
    options: [],
    today,
    todayLabel: `${formatKeyWeekdayLong(today)}, ${formatKeyDate(today)}`,
    clinicName: config.clinicName,
    assistantName: config.assistantName,
  });
  const sources = selected.filter((passage) => interpretation.answer.sourceIds.includes(passage.id));
  const guard = interpretation.answer.found ? checkGroundedAnswer(interpretation.answer.text, sources) : null;

  await recordAudit(db, {
    ...auditContext(actor),
    action: "assistant.test",
    metadata: { includeDrafts: input.includeDrafts, found: Boolean(guard?.ok), engine: model.name },
  });

  return {
    engine: model.name,
    intent: interpretation.intent,
    answer: guard?.ok ? interpretation.answer.text : null,
    blockedReason: guard && !guard.ok ? guard.reason : null,
    sources: sources.map((source) => ({ id: source.id, title: source.title })),
    considered: selected.length,
    clinical: interpretation.flags.clinical,
    urgent: interpretation.flags.urgent,
    wantsHuman: interpretation.flags.wantsHuman || interpretation.intent === "human",
  };
}
