import { z } from "zod";

import type { AssistantOutcome } from "@/generated/prisma/enums";
import { fillTemplate, type AssistantConfig } from "@/lib/assistant-config";

import { CONSENT_GRANTED_TEXT, type TurnResult } from "../engine";
import { checkAgentReply } from "../guard";
import { CLINICAL } from "../rules-model";
import type { AppointmentOption, AssistantState } from "../state";
import { detectConsentKeyword, normalizeText, parseOptionNumber, parseYesNo } from "../text";
import { AssistantModelError, type KnowledgePassage } from "../types";

import {
  AGENT_OUTPUT_INTENTS,
  AGENT_OUTPUT_SCHEMA,
  buildSystemPrompt,
  renderTurnContext,
  type AgentContactProfile,
  type AgentHistoryMessage,
} from "./prompt";
import { AgentToolbox, agentToolSpecs, type AgentPorts, type ReturnOption } from "./tools";
import { emptyUsage, type AgentMessage, type AgentRuntime, type AgentToolCall, type AgentUsage } from "./types";

/**
 * Turno da IA generativa (sem banco: todo efeito passa pelas portas).
 *
 * 1. Etapas determinísticas, sem IA: descadastro/recadastro por palavra-chave
 *    (valem inclusive no atendimento humano), silêncio no atendimento humano,
 *    "CANCELAR" ambíguo, resposta à pergunta de consentimento e sinais de
 *    urgência de saúde (encaminhamento imediato, com a orientação configurada).
 * 2. O modelo gera a resposta usando o contexto do contato, a base aprovada e
 *    as ferramentas do CRM (validadas e executadas pelo servidor).
 * 3. A resposta passa pela checagem de segurança; se reprovada, o modelo
 *    reescreve uma vez com o motivo; persistindo, nada inventado é enviado.
 * 4. O servidor completa o que não pode depender do modelo: transferência em
 *    dúvidas de saúde, pendências da base, pergunta de consentimento após
 *    agendar e textos de segurança.
 */

export interface AgentTurnInput {
  kind: "reply" | "follow_up";
  conversationId: string;
  inboundMessageId: string | null;
  /** Mensagem(ns) do contato sem resposta, como recebidas (usadas só localmente). */
  text: string;
  /** As mesmas mensagens com dados pessoais mascarados (enviadas ao modelo). */
  maskedMessages: string[];
  history: AgentHistoryMessage[];
  mode: "ASSISTANT" | "HUMAN";
  now: Date;
  today: string;
  nowLabel: string;
  timeZone: string;
  config: AssistantConfig;
  contact: AgentContactProfile & { ambiguous: boolean };
  state: AssistantState;
  memory: string | null;
  passages: KnowledgePassage[];
  appointments: AppointmentOption[];
  returns: ReturnOption[];
  bookingProcedure: string | null;
  followUpHoursSilent?: number;
}

export interface AgentTurnResult extends TurnResult {
  /** Notas da conversa atualizadas (`undefined` = sem alteração). */
  memory: string | undefined;
  usage: AgentUsage;
  modelCalls: number;
  modelLatencyMs: number;
  toolCalls: string[];
  engine: string;
}

/** Sintomas possivelmente graves: transferência imediata, sem depender do modelo. */
const URGENT_HEALTH =
  /\b(falta de ar|nao consigo respirar|dificuldade (para|pra) respirar|desmai\w*|sangrando muito|sangramento (forte|intenso|que nao para)|dor (muito )?(forte|insuportavel)|muita dor|inchaco (forte|intenso)|muito inchad\w*|febre alta|perdi a visao|visao turva|nao consigo enxergar|necrose|pus|infeccionou|emergencia)\b/;

const finalSchema = z.object({
  reply: z.string(),
  intent: z.enum(AGENT_OUTPUT_INTENTS),
  source_refs: z.array(z.string()),
  knowledge_gap: z.boolean(),
  clinical_question: z.boolean(),
  urgent_health_issue: z.boolean(),
  wants_human: z.boolean(),
  confidence: z.number(),
});

type FinalAnswer = z.output<typeof finalSchema>;

const MAX_CORRECTIONS = 2;

function vars(config: AssistantConfig, firstName: string | null, extra: Record<string, string | null | undefined> = {}) {
  return {
    assistente: config.assistantName,
    clinica: config.clinicName,
    nome: firstName ?? "",
    horario_equipe: config.teamHoursText ? `Nossa equipe atende ${config.teamHoursText}.` : "",
    ...extra,
  };
}

function formatDateLabel(dateKey: string): string {
  const [year, month, day] = dateKey.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  const weekday = new Intl.DateTimeFormat("pt-BR", { weekday: "long", timeZone: "UTC" }).format(date);
  return `${weekday}, ${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}`;
}

class TurnOutput {
  state: AssistantState;
  reply: string | null = null;
  outcome: AssistantOutcome = "SILENT";
  intent: string | null = null;
  confidence: number | null = null;
  sourceIds: string[] = [];
  readonly flags = new Set<string>();

  constructor(state: AssistantState) {
    this.state = state;
  }

  result(extra: Omit<AgentTurnResult, keyof TurnResult>, now: Date): AgentTurnResult {
    this.state.updatedAt = now.toISOString();
    return {
      reply: this.reply?.trim() ? this.reply.trim() : null,
      state: this.state,
      outcome: this.outcome,
      intent: this.intent,
      confidence: this.confidence,
      sourceIds: this.sourceIds,
      flags: [...this.flags],
      ...extra,
    };
  }
}

const noUsage = (engine: string) => ({ memory: undefined, usage: emptyUsage(), modelCalls: 0, modelLatencyMs: 0, toolCalls: [], engine });

// -----------------------------------------------------------------------------
// 1. Etapas determinísticas
// -----------------------------------------------------------------------------

async function runPreamble(input: AgentTurnInput, ports: AgentPorts, signals: string[]): Promise<AgentTurnResult | null> {
  const { config, now } = input;
  const out = new TurnOutput(structuredClone(input.state));
  const say = (key: keyof AssistantConfig["messages"]) => fillTemplate(config.messages[key], vars(config, input.contact.firstName));
  const keywordEngine = "keywords";

  const optOut = async () => {
    await ports.optOut();
    out.state.pendingAction = null;
    out.state.step = null;
    out.reply = say("optOutConfirmation");
    out.outcome = "OPT_OUT";
    return out.result(noUsage(keywordEngine), now);
  };

  const keyword = detectConsentKeyword(input.text);
  if (keyword === "opt_out") return optOut();
  if (keyword === "opt_in") {
    await ports.optIn();
    out.reply = say("optInConfirmation");
    out.outcome = "OPT_IN";
    return out.result(noUsage(keywordEngine), now);
  }

  if (input.mode === "HUMAN") {
    out.flags.add("human_mode");
    return out.result(noUsage(keywordEngine), now);
  }

  // Possível urgência de saúde: tem prioridade sobre qualquer etapa pendente — a
  // equipe é acionada na hora, com a orientação de segurança configurada.
  if (URGENT_HEALTH.test(normalizeText(input.text))) {
    await ports.handoff("Possível urgência de saúde relatada pelo contato", {
      urgent: true,
      summary: input.memory ? `Resumo da conversa: ${input.memory}` : null,
    });
    out.state.pendingAction = null;
    out.state.step = null;
    out.reply = say("urgentHealth");
    out.outcome = "HANDOFF";
    out.flags.add("urgent_health");
    return out.result(noUsage("safety"), now);
  }

  if (keyword === "ambiguous_cancel") {
    if (input.appointments.length === 0 && !out.state.pendingAction) return optOut();
    out.state.step = "clarify_cancel";
    out.reply =
      "Você quer cancelar um agendamento ou parar de receber mensagens automáticas da clínica?\n1. Cancelar agendamento\n2. Parar de receber mensagens";
    out.outcome = "ASKED";
    return out.result(noUsage(keywordEngine), now);
  }

  if (out.state.step === "clarify_cancel") {
    const message = normalizeText(input.text);
    const option = parseOptionNumber(input.text, 2);
    out.state.step = null;
    if (option === 2 || /\b(mensage(m|ns)|parar|receber)\b/.test(message)) return optOut();
    if (option === 1 || /\b(agendamento|consulta|horario|avaliacao)\b/.test(message)) {
      signals.push("O contato respondeu que quer CANCELAR UM AGENDAMENTO (não é descadastro). Identifique qual e proponha o cancelamento.");
    }
    // Segue para a IA, com a etapa limpa.
    input.state = out.state;
  }

  if (out.state.step === "ask_consent") {
    const yesNo = parseYesNo(input.text);
    out.state.step = null;
    if (yesNo === true) {
      await ports.grantRemindersConsent();
      out.reply = CONSENT_GRANTED_TEXT;
      out.outcome = "ANSWERED";
      return out.result(noUsage(keywordEngine), now);
    }
    if (yesNo === false) {
      out.reply = "Tudo bem, não vou enviar lembretes automáticos. Se precisar de algo, é só chamar.";
      out.outcome = "ANSWERED";
      return out.result(noUsage(keywordEngine), now);
    }
    // Não respondeu à pergunta: segue para a IA.
    input.state = out.state;
  }

  return null;
}

// -----------------------------------------------------------------------------
// 2–4. Turno com o modelo
// -----------------------------------------------------------------------------

function textOf(content: AgentMessage["content"]): string {
  return content
    .filter((block): block is { type: "text"; text: string } => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();
}

function parseFinal(text: string): FinalAnswer | null {
  try {
    const parsed = finalSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function runAgentTurn(input: AgentTurnInput, ports: AgentPorts, runtime: AgentRuntime): Promise<AgentTurnResult> {
  const signals: string[] = [];
  if (input.kind === "reply") {
    const early = await runPreamble(input, ports, signals);
    if (early) return early;
    if (CLINICAL.test(normalizeText(input.text))) {
      signals.push("A mensagem pode conter uma dúvida de saúde: não oriente; se for o caso, marque clinical_question.");
    }
    if (!input.history.some((message) => message.from === "assistant")) {
      signals.push("Esta é a primeira resposta da assistente nesta conversa: apresente-se brevemente.");
    }
  }

  const { config, now } = input;
  const toolbox = new AgentToolbox(
    {
      kind: input.kind,
      now,
      today: input.today,
      conversationId: input.conversationId,
      contactText: input.text,
      inboundMessageId: input.inboundMessageId,
      contactKind: input.contact.kind,
      ambiguousContact: input.contact.ambiguous,
      shareCatalogPrices: config.agent.shareCatalogPrices,
      bookingEnabled: Boolean(input.bookingProcedure),
      pendingTtlHours: config.limits.stateTtlHours,
      memory: input.memory,
    },
    ports,
    { state: input.state, knowledge: input.passages, appointments: input.appointments, returns: input.returns },
  );
  if (input.contact.ambiguous) signals.push("Este telefone pertence a mais de um paciente: não trate de agendamentos; transfira para a equipe se pedirem.");

  const context = renderTurnContext({
    kind: input.kind,
    config,
    nowLabel: input.nowLabel,
    today: input.today,
    timeZone: input.timeZone,
    contact: input.contact,
    memory: input.memory,
    pendingAction: toolbox.state.pendingAction,
    offeredSlots: toolbox.state.offeredSlots,
    appointments: input.appointments,
    returns: input.returns,
    knowledge: input.passages.map((passage) => ({ ref: toolbox.knowledgeRef(passage), passage })),
    history: input.history,
    newMessages: input.maskedMessages,
    signals,
    bookingProcedure: input.bookingProcedure,
    followUpHoursSilent: input.followUpHoursSilent,
  });

  const session: Session = {
    input,
    ports,
    runtime,
    toolbox,
    out: new TurnOutput(toolbox.state),
    system: buildSystemPrompt(config),
    tools: agentToolSpecs(input.kind),
    messages: [{ role: "user", content: [{ type: "text", text: context }] }],
    usage: emptyUsage(),
    modelCalls: 0,
    modelLatencyMs: 0,
    abort: new AbortController(),
    deadline: Date.now() + runtime.turnTimeoutMs,
  };
  const timer = setTimeout(
    () => session.abort.abort(new AssistantModelError("Tempo do turno esgotado.", "turn_timeout", true)),
    runtime.turnTimeoutMs,
  );
  try {
    let final: FinalAnswer | GuardBlocked;
    try {
      final = await converse(session);
    } catch (error) {
      if (!toolbox.hasCriticalEffects()) throw withUsage(error, session);
      // Algo já foi gravado (agendamento, cancelamento, transferência…): não repete
      // o turno às cegas — informa o contato com o texto configurado da ação.
      session.out.flags.add("model_error_after_action");
      if (error instanceof AssistantModelError) session.out.flags.add(`model_error:${error.code}`);
      return composeAfterActions(session);
    }
    return final === GUARD_BLOCKED ? await composeBlocked(session) : await compose(session, final);
  } finally {
    clearTimeout(timer);
  }
}

// -----------------------------------------------------------------------------
// Laço de chamadas ao modelo
// -----------------------------------------------------------------------------

interface Session {
  input: AgentTurnInput;
  ports: AgentPorts;
  runtime: AgentRuntime;
  toolbox: AgentToolbox;
  out: TurnOutput;
  system: string;
  tools: ReturnType<typeof agentToolSpecs>;
  messages: AgentMessage[];
  usage: AgentUsage;
  modelCalls: number;
  modelLatencyMs: number;
  abort: AbortController;
  deadline: number;
}

/** Consumo de um turno que falhou (a chamada foi cobrada pelo provedor mesmo assim). */
export interface FailedTurnUsage {
  usage: AgentUsage;
  modelCalls: number;
  modelLatencyMs: number;
  toolCalls: string[];
}

const USAGE = Symbol("agent_usage");

function withUsage(error: unknown, session: Session): unknown {
  if (error && typeof error === "object") {
    (error as { [USAGE]?: FailedTurnUsage })[USAGE] = {
      usage: session.usage,
      modelCalls: session.modelCalls,
      modelLatencyMs: session.modelLatencyMs,
      toolCalls: session.toolbox.toolCalls,
    };
  }
  return error;
}

export function failedTurnUsage(error: unknown): FailedTurnUsage | null {
  return error && typeof error === "object" ? ((error as { [USAGE]?: FailedTurnUsage })[USAGE] ?? null) : null;
}

const GUARD_BLOCKED = Symbol("guard_blocked");
type GuardBlocked = typeof GUARD_BLOCKED;

function finish(session: Session): AgentTurnResult {
  const { out, toolbox, usage, modelCalls, modelLatencyMs, runtime, input } = session;
  return out.result(
    { memory: toolbox.memory, usage, modelCalls, modelLatencyMs, toolCalls: toolbox.toolCalls, engine: runtime.model.name },
    input.now,
  );
}

function say(session: Session, key: keyof AssistantConfig["messages"], extra: Record<string, string | null | undefined> = {}): string {
  const { config, contact } = session.input;
  return fillTemplate(config.messages[key], vars(config, session.out.state.name ?? contact.firstName, extra));
}

/** Chama o modelo até a resposta final válida, executando no caminho as ferramentas pedidas. */
async function converse(session: Session): Promise<FinalAnswer | GuardBlocked> {
  const { input, runtime, toolbox, messages, out } = session;
  const { config } = input;
  const maxCalls = config.agent.maxModelCallsPerTurn;
  let corrections = 0;

  for (;;) {
    if (session.modelCalls >= maxCalls) throw new AssistantModelError("Limite de chamadas ao modelo no turno.", "call_limit", false);
    const remaining = session.deadline - Date.now();
    if (remaining <= 1_000) throw new AssistantModelError("Tempo do turno esgotado.", "turn_timeout", true);

    const startedAt = Date.now();
    const response = await runtime.limiter.run(
      () =>
        runtime.model.complete({
          system: session.system,
          messages,
          tools: session.tools,
          outputSchema: AGENT_OUTPUT_SCHEMA as unknown as Record<string, unknown>,
          maxOutputTokens: runtime.maxOutputTokens,
          timeoutMs: Math.min(runtime.callTimeoutMs, remaining),
          signal: session.abort.signal,
        }),
      session.abort.signal,
    );
    session.modelCalls += 1;
    session.modelLatencyMs += Date.now() - startedAt;
    session.usage.inputTokens += response.usage.inputTokens;
    session.usage.outputTokens += response.usage.outputTokens;
    session.usage.cacheReadTokens += response.usage.cacheReadTokens;
    session.usage.cacheWriteTokens += response.usage.cacheWriteTokens;

    if (response.stopReason === "refusal") throw new AssistantModelError("O modelo recusou a mensagem.", "refusal", false);
    if (response.stopReason === "max_tokens") throw new AssistantModelError("Resposta do modelo incompleta.", "max_tokens", false);

    messages.push({ role: "assistant", content: response.content, providerContent: response.providerContent });
    const calls = response.content.filter((block): block is AgentToolCall => block.type === "tool_call");

    if (calls.length > 0) {
      const results = [];
      for (const call of calls) results.push(await toolbox.execute(call));
      const lastChance = session.modelCalls + 1 >= maxCalls;
      messages.push({
        role: "user",
        content: [
          ...results,
          ...(lastChance
            ? [{ type: "text" as const, text: "(sistema) Esta é a última etapa: responda agora ao contato no formato final, sem usar ferramentas." }]
            : []),
        ],
      });
      continue;
    }

    const candidate = parseFinal(textOf(response.content));
    if (!candidate) {
      if (corrections >= MAX_CORRECTIONS) throw new AssistantModelError("Resposta do modelo fora do formato esperado.", "invalid_output", false);
      corrections += 1;
      messages.push({ role: "user", content: [{ type: "text", text: "(sistema) Responda no formato JSON pedido, com todos os campos." }] });
      continue;
    }

    const verdict = checkAgentReply(candidate.reply, {
      facts: allowedFacts(input, toolbox),
      completed: {
        booked: Boolean(toolbox.done.booked),
        rescheduled: Boolean(toolbox.done.rescheduled),
        cancelled: Boolean(toolbox.done.cancelled),
      },
      maxChars: config.agent.maxReplyChars,
      previousReplies: input.history
        .filter((message) => message.from === "assistant")
        .slice(-3)
        .map((message) => message.text),
    });
    if (verdict.ok) return candidate;

    out.flags.add(`guard:${verdict.reason}`);
    if (corrections >= MAX_CORRECTIONS || session.modelCalls >= maxCalls) return GUARD_BLOCKED;
    corrections += 1;
    messages.push({
      role: "user",
      content: [{ type: "text", text: `(verificação automática) A resposta não foi enviada: ${verdict.detail} Reescreva a resposta respeitando as regras.` }],
    });
  }
}

/** A checagem reprovou a resposta mesmo após a correção: nada sem verificação é enviado. */
async function composeBlocked(session: Session): Promise<AgentTurnResult> {
  const { out, input, ports } = session;
  out.flags.add("guard_blocked");
  // Acompanhamento bloqueado: simplesmente não é enviado (não há pergunta do contato).
  if (input.kind === "reply") {
    await ports.recordGap("BLOCKED_ANSWER", input.maskedMessages.join("\n"));
    out.reply = say(session, "noAnswer");
    out.outcome = "NO_ANSWER";
  }
  return finish(session);
}

// -----------------------------------------------------------------------------
// Composição final (regras que não dependem do modelo)
// -----------------------------------------------------------------------------

async function compose(session: Session, final: FinalAnswer): Promise<AgentTurnResult> {
  const { out, input, ports, toolbox } = session;
  const { config } = input;
  out.intent = final.intent;
  out.confidence = Math.min(1, Math.max(0, final.confidence));
  out.sourceIds = toolbox.resolveKnowledgeRefs(final.source_refs);
  out.reply = final.reply.trim() || null;

  if (toolbox.done.optedOut) {
    out.reply = say(session, "optOutConfirmation");
    out.outcome = "OPT_OUT";
    return finish(session);
  }

  if (final.urgent_health_issue) {
    if (!toolbox.done.handoff) {
      await ports.handoff("Possível urgência de saúde relatada pelo contato", { urgent: true, summary: toolbox.handoffSummary() });
    }
    out.state.pendingAction = null;
    out.flags.add("urgent_health");
    out.reply = say(session, "urgentHealth");
    out.outcome = "HANDOFF";
    return finish(session);
  }

  if (input.kind === "follow_up") {
    out.outcome = out.reply ? "ASKED" : "SILENT";
    out.flags.add("follow_up");
    return finish(session);
  }

  const handoff = async (reason: string, flag: string | null, fallback: keyof AssistantConfig["messages"]) => {
    if (flag) out.flags.add(flag);
    await ports.handoff(reason, { urgent: false, summary: toolbox.handoffSummary() });
    toolbox.done.handoff = { reason, urgent: false };
    out.reply = out.reply ?? say(session, fallback);
  };
  if (toolbox.done.executionError && !toolbox.done.handoff) {
    await handoff("Falha ao executar uma ação pedida pelo contato", `execution_error:${toolbox.done.executionError}`, "handoff");
  }
  if (final.clinical_question && !toolbox.done.handoff) {
    await handoff("Pergunta de saúde: só a equipe responde", "clinical_question", "clinicalDeflection");
  }
  if (final.wants_human && !toolbox.done.handoff) {
    await handoff("Pediu para falar com a equipe", null, "handoff");
  }

  if (final.knowledge_gap) {
    out.flags.add("knowledge_gap");
    await ports.recordGap("NO_ANSWER", input.maskedMessages.join("\n"));
    out.state.unknownCount += 1;
    if (out.state.unknownCount >= config.limits.maxUnknownBeforeHandoff && !toolbox.done.handoff) {
      out.state.unknownCount = 0;
      await handoff("Perguntas sem resposta na base aprovada", "repeated_knowledge_gaps", "handoff");
    }
  } else if (out.sourceIds.length > 0) {
    out.state.unknownCount = 0;
  }

  if (toolbox.done.handoff) {
    out.state.pendingAction = null;
    out.reply = out.reply ?? say(session, "handoff");
    out.outcome = "HANDOFF";
    return finish(session);
  }

  appendConsentQuestion(session);
  out.outcome = outcomeOf(toolbox, final, out.reply);
  return finish(session);
}

/** Fatos que a resposta pode citar: clínica, base aprovada recebida e resultados das ferramentas. */
function allowedFacts(input: AgentTurnInput, toolbox: AgentToolbox): string {
  return [
    input.config.clinicName,
    input.config.teamHoursText,
    ...toolbox.knowledge.map((passage) => `${passage.title}\n${passage.content}`),
    ...toolbox.facts,
    ...input.appointments.map((item) => item.label),
    ...toolbox.state.offeredSlots.map((slot) => slot.label),
    ...input.returns.map((item) => `${item.label} ${item.dueDateLabel}`),
  ].join("\n");
}

function appendConsentQuestion(session: Session) {
  // Depois de agendar, a pergunta de consentimento é a do texto configurado (prova do consentimento).
  const { toolbox, out, input } = session;
  if (!toolbox.done.booked && !toolbox.done.rescheduled) return;
  const { config, contact } = input;
  if (!config.askReminderConsent || contact.remindersConsent || contact.optedOut || out.state.consentAsked) return;
  out.state.consentAsked = true;
  out.state.step = "ask_consent";
  out.reply = [out.reply, say(session, "consentQuestion")].filter(Boolean).join("\n\n");
}

function outcomeOf(toolbox: AgentToolbox, final: FinalAnswer, reply: string | null): AssistantOutcome {
  const done = toolbox.done;
  if (done.booked) return "BOOKED";
  if (done.rescheduled) return "RESCHEDULED";
  if (done.cancelled) return "APPOINTMENT_CANCELLED";
  if (!reply) return "SILENT";
  if (done.proposed) return "AWAITING_CONFIRMATION";
  if (done.offeredSlots) return "OFFERED_SLOTS";
  if (final.knowledge_gap) return "NO_ANSWER";
  if (reply.includes("?")) return "ASKED";
  return "ANSWERED";
}

/** Resposta segura quando o modelo falhou DEPOIS de o servidor gravar uma ação. */
async function composeAfterActions(session: Session): Promise<AgentTurnResult> {
  const { toolbox, out } = session;
  const done = toolbox.done;
  if (done.optedOut) {
    out.reply = say(session, "optOutConfirmation");
    out.outcome = "OPT_OUT";
  } else if (done.booked) {
    out.reply = say(session, "bookingConfirmed", {
      data: formatDateLabel(done.booked.slot.dateKey),
      hora: done.booked.slot.time,
      procedimento: done.booked.procedureName ?? "",
    });
    out.outcome = "BOOKED";
  } else if (done.rescheduled) {
    out.reply = say(session, "rescheduled", { data: formatDateLabel(done.rescheduled.slot.dateKey), hora: done.rescheduled.slot.time });
    out.outcome = "RESCHEDULED";
  } else if (done.cancelled) {
    out.reply = say(session, "appointmentCancelled", { data: done.cancelled.dateLabel, hora: done.cancelled.time });
    out.outcome = "APPOINTMENT_CANCELLED";
  } else if (done.handoff) {
    out.reply = done.handoff.urgent ? say(session, "urgentHealth") : say(session, "handoff");
    out.outcome = "HANDOFF";
  } else {
    out.reply = "Obrigada por confirmar! Qualquer coisa, é só chamar por aqui.";
    out.outcome = "ANSWERED";
  }
  if (!done.handoff && !done.optedOut) appendConsentQuestion(session);
  return finish(session);
}
