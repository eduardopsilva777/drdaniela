import "server-only";

import { formatKeyDate, formatKeyWeekdayLong, todayKey } from "@/lib/datetime";
import { runAgentTurn } from "@/server/assistant/agent/run-turn";
import { InMemoryCrm } from "@/server/assistant/agent/simulator";
import type { AgentRuntime } from "@/server/assistant/agent/types";
import { checkGroundedAnswer } from "@/server/assistant/guard";
import { initialAssistantState } from "@/server/assistant/state";
import type { AssistantModel, KnowledgePassage } from "@/server/assistant/types";
import { recordAudit } from "@/server/audit";
import type { DbClient } from "@/server/db/prisma";
import { maskSensitiveText } from "@/server/logging/redact";

import { getAssistantConfig } from "./assistant-settings";
import { assertPermission, auditContext, type Actor } from "./context";
import { loadDraftPassages, loadPublishedPassages, selectPassages } from "./knowledge";

export interface KnowledgeTestResult {
  engine: string;
  intent: string;
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
async function loadTestPassages(db: DbClient, includeDrafts: boolean): Promise<KnowledgePassage[]> {
  const published = await loadPublishedPassages(db);
  if (!includeDrafts) return published;
  const drafts = await loadDraftPassages(db);
  const draftIds = new Set(drafts.map((draft) => draft.id));
  return [...published.filter((passage) => !draftIds.has(passage.id)), ...drafts];
}

/** Ids fixos do teste: a conversa simulada não existe no banco. */
const TEST_CONVERSATION_ID = "00000000-0000-7000-8000-000000000001";
const TEST_MESSAGE_ID = "00000000-0000-7000-8000-000000000002";

/**
 * Teste com a IA conversacional: a mesma geração, as mesmas ferramentas de
 * consulta e a mesma checagem do atendimento real, sobre um CRM simulado —
 * agenda e cadastro desativados, nada é gravado e nenhuma mensagem é enviada.
 * Usa o provedor de IA (uma a três chamadas por teste).
 */
export async function testKnowledgeQuestionWithAgent(
  db: DbClient,
  actor: Actor,
  runtime: AgentRuntime,
  input: { question: string; includeDrafts: boolean },
  options: { timeZone: string; now?: Date },
): Promise<KnowledgeTestResult> {
  assertPermission(actor, "knowledge:write");
  const now = options.now ?? new Date();
  const config = await getAssistantConfig(db);
  const passages = await loadTestPassages(db, input.includeDrafts);
  const procedures = await db.procedure.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    take: 40,
    select: { name: true, category: true, durationMinutes: true, priceCents: true },
  });
  const crm = new InMemoryCrm({ knowledge: passages, services: procedures, slots: null });
  const question = maskSensitiveText(input.question).slice(0, 500);
  const today = todayKey(options.timeZone, now);
  const result = await runAgentTurn(
    {
      kind: "reply",
      conversationId: TEST_CONVERSATION_ID,
      inboundMessageId: TEST_MESSAGE_ID,
      text: question,
      maskedMessages: [question],
      history: [],
      mode: "ASSISTANT",
      now,
      today,
      nowLabel: `${formatKeyWeekdayLong(today)}, ${formatKeyDate(today)}`,
      timeZone: options.timeZone,
      config,
      contact: {
        kind: "unknown",
        firstName: null,
        leadStage: null,
        interest: null,
        remindersConsent: false,
        marketingConsent: false,
        optedOut: false,
        lastVisitLabel: null,
        ambiguous: false,
      },
      state: initialAssistantState(),
      memory: null,
      passages: selectPassages(question, passages).slice(0, 8),
      appointments: [],
      returns: [],
      bookingProcedure: null,
    },
    crm,
    runtime,
  );

  await recordAudit(db, {
    ...auditContext(actor),
    action: "assistant.test",
    metadata: { includeDrafts: input.includeDrafts, found: Boolean(result.reply), engine: result.engine },
  });

  const titles = new Map(passages.map((passage) => [passage.id, passage.title]));
  const blocked = result.flags.includes("guard_blocked");
  return {
    engine: result.engine,
    intent: result.intent ?? result.outcome.toLowerCase(),
    answer: blocked ? null : result.reply,
    blockedReason: blocked ? (result.flags.find((flag) => flag.startsWith("guard:"))?.slice("guard:".length) ?? null) : null,
    sources: result.sourceIds.map((id) => ({ id, title: titles.get(id) ?? "Entrada" })),
    considered: passages.length,
    clinical: result.flags.includes("clinical_question") || result.flags.includes("urgent_health"),
    urgent: result.flags.includes("urgent_health"),
    wantsHuman: crm.handoffs.length > 0 && !result.flags.includes("clinical_question") && !result.flags.includes("urgent_health"),
  };
}

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
  const passages = await loadTestPassages(db, input.includeDrafts);
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
