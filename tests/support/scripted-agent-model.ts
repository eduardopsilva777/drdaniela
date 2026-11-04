import { createConcurrencyLimiter, type AgentModel, type AgentRequest, type AgentResponse, type AgentRuntime, type AgentUsage } from "@/server/assistant/agent/types";

/**
 * Provedor de IA falso para os testes: devolve respostas roteirizadas (chamadas
 * de ferramenta ou resposta final) e registra o que recebeu. Nada sai do processo.
 */

export type ScriptStep = AgentResponse | Error | ((request: AgentRequest) => AgentResponse | Promise<AgentResponse>);

const USAGE: AgentUsage = { inputTokens: 1_000, outputTokens: 200, cacheReadTokens: 3_000, cacheWriteTokens: 0 };

export class ScriptedAgentModel implements AgentModel {
  readonly name = "scripted:test";
  readonly maxLatencyMs = 30_000;
  readonly requests: AgentRequest[] = [];
  private readonly steps: ScriptStep[];

  constructor(steps: ScriptStep[] = []) {
    this.steps = [...steps];
  }

  /** Acrescenta passos (ex.: para a próxima mensagem do contato). */
  then(...steps: ScriptStep[]): this {
    this.steps.push(...steps);
    return this;
  }

  get pending(): number {
    return this.steps.length;
  }

  async complete(request: AgentRequest): Promise<AgentResponse> {
    // Cópia: o orquestrador continua acrescentando mensagens à mesma lista.
    this.requests.push({ ...request, messages: [...request.messages] });
    const step = this.steps.shift();
    if (!step) throw new Error("ScriptedAgentModel: nenhuma resposta programada para esta chamada.");
    if (step instanceof Error) throw step;
    return typeof step === "function" ? step(request) : step;
  }
}

let callSequence = 0;

/** O modelo pede uma (ou mais) ferramentas. */
export function toolCall(name: string, input: Record<string, unknown> = {}, ...more: Array<[string, Record<string, unknown>]>): AgentResponse {
  const calls = [[name, input] as [string, Record<string, unknown>], ...more];
  return {
    content: calls.map(([toolName, toolInput]) => ({ type: "tool_call" as const, id: `toolu_${++callSequence}`, name: toolName, input: toolInput })),
    stopReason: "tool_use",
    usage: USAGE,
    model: "scripted:test",
  };
}

export interface FinalFields {
  intent?: string;
  source_refs?: string[];
  knowledge_gap?: boolean;
  clinical_question?: boolean;
  urgent_health_issue?: boolean;
  wants_human?: boolean;
  confidence?: number;
}

/** Resposta final do modelo (texto ao contato + sinais). */
export function finalReply(reply: string, fields: FinalFields = {}): AgentResponse {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify({
          reply,
          intent: fields.intent ?? "other",
          source_refs: fields.source_refs ?? [],
          knowledge_gap: fields.knowledge_gap ?? false,
          clinical_question: fields.clinical_question ?? false,
          urgent_health_issue: fields.urgent_health_issue ?? false,
          wants_human: fields.wants_human ?? false,
          confidence: fields.confidence ?? 0.9,
        }),
      },
    ],
    stopReason: "end_turn",
    usage: USAGE,
    model: "scripted:test",
  };
}

export function rawText(text: string): AgentResponse {
  return { content: [{ type: "text", text }], stopReason: "end_turn", usage: USAGE, model: "scripted:test" };
}

export function testRuntime(model: AgentModel, overrides: Partial<AgentRuntime> = {}): AgentRuntime {
  return {
    model,
    pricing: { inputPerMTok: 4, outputPerMTok: 20, cacheReadPerMTok: 0.2, cacheWritePerMTok: 5 },
    maxOutputTokens: 8_000,
    callTimeoutMs: 30_000,
    turnTimeoutMs: 60_000,
    limiter: createConcurrencyLimiter(3),
    ...overrides,
  };
}

/** Texto da resposta da ferramenta que o orquestrador devolveu ao modelo (último pedido registrado). */
export function lastToolResults(model: ScriptedAgentModel): Array<{ content: string; isError: boolean }> {
  const request = model.requests.at(-1);
  const last = request?.messages.at(-1);
  if (!last || last.role !== "user") return [];
  return last.content.flatMap((block) => (block.type === "tool_result" ? [{ content: block.content, isError: block.isError }] : []));
}
