/**
 * Contrato entre o agente conversacional e o provedor de IA — independente de
 * fornecedor. O CRM só conhece estes tipos: trocar de provedor (ou usar um
 * modelo local) é implementar `AgentModel`, sem mexer nas ferramentas, nas
 * regras de negócio ou na fila.
 *
 * O modelo NUNCA acessa o banco: ele pede ferramentas pelo nome, com argumentos
 * que o servidor valida (lista fechada + schema) e executa com as regras do CRM.
 */

export interface AgentToolSpec {
  name: string;
  description: string;
  /** JSON Schema do argumento (objeto fechado, todos os campos obrigatórios). */
  inputSchema: Record<string, unknown>;
}

export type AgentTextBlock = { type: "text"; text: string };
export type AgentToolCall = { type: "tool_call"; id: string; name: string; input: unknown };
export type AgentToolResult = { type: "tool_result"; toolCallId: string; content: string; isError: boolean };

export type AgentMessage =
  | { role: "user"; content: Array<AgentTextBlock | AgentToolResult> }
  | {
      role: "assistant";
      content: Array<AgentTextBlock | AgentToolCall>;
      /**
       * Conteúdo original do provedor (ex.: blocos de raciocínio), devolvido sem
       * alteração nas chamadas seguintes do mesmo turno. Outros provedores ignoram.
       */
      providerContent?: unknown;
    };

export interface AgentRequest {
  /** Instruções fixas (identidade + regras): estáveis entre conversas, cacheáveis. */
  system: string;
  messages: AgentMessage[];
  tools: AgentToolSpec[];
  /** JSON Schema da resposta final (texto ao contato + sinais). */
  outputSchema: Record<string, unknown>;
  maxOutputTokens: number;
  /** Tempo limite desta chamada (o turno inteiro tem o seu, via `signal`). */
  timeoutMs: number;
  signal?: AbortSignal;
}

export interface AgentUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export type AgentStopReason = "end_turn" | "tool_use" | "max_tokens" | "refusal" | "other";

export interface AgentResponse {
  content: Array<AgentTextBlock | AgentToolCall>;
  providerContent?: unknown;
  stopReason: AgentStopReason;
  usage: AgentUsage;
  /** Modelo que efetivamente respondeu (pode diferir do configurado, ex.: fallback do provedor). */
  model: string;
}

export interface AgentModel {
  /** Ex.: "anthropic:claude-opus-5-5" — registrado em cada execução. */
  readonly name: string;
  /** Pior caso de um turno inteiro (dimensiona a reserva da conversa na fila). */
  readonly maxLatencyMs: number;
  complete(request: AgentRequest): Promise<AgentResponse>;
}

/** Preços em US$ por milhão de tokens (estimativa de custo e limite mensal). */
export interface ModelPricing {
  inputPerMTok: number;
  outputPerMTok: number;
  cacheReadPerMTok: number;
  cacheWritePerMTok: number;
}

/** Tudo o que o processador precisa para usar a IA generativa. */
export interface AgentRuntime {
  model: AgentModel;
  pricing: ModelPricing;
  maxOutputTokens: number;
  /** Tempo limite de cada chamada ao provedor. */
  callTimeoutMs: number;
  /** Tempo limite do turno inteiro (todas as chamadas e ferramentas). */
  turnTimeoutMs: number;
  /** Limita chamadas simultâneas ao provedor neste processo. */
  limiter: ConcurrencyLimiter;
}

export interface ConcurrencyLimiter {
  run<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T>;
}

export const emptyUsage = (): AgentUsage => ({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });

/** Custo estimado em milionésimos de dólar. */
export function costMicros(usage: AgentUsage, pricing: ModelPricing): number {
  const dollars =
    (usage.inputTokens * pricing.inputPerMTok +
      usage.outputTokens * pricing.outputPerMTok +
      usage.cacheReadTokens * pricing.cacheReadPerMTok +
      usage.cacheWriteTokens * pricing.cacheWritePerMTok) /
    1_000_000;
  return Math.round(dollars * 1_000_000);
}

/** Semáforo simples por processo (o provedor também limita; isto evita rajadas). */
export function createConcurrencyLimiter(maxConcurrent: number): ConcurrencyLimiter {
  let active = 0;
  const waiting: Array<() => void> = [];
  // A vaga passa direto para quem espera (sem liberar e reocupar), para que uma
  // chamada nova não ultrapasse o limite nesse intervalo.
  const release = () => {
    const next = waiting.shift();
    if (next) next();
    else active -= 1;
  };
  return {
    async run<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
      if (active < maxConcurrent) {
        active += 1;
      } else {
        await new Promise<void>((resolve, reject) => {
          const onAbort = () => {
            const index = waiting.indexOf(start);
            if (index >= 0) waiting.splice(index, 1);
            reject(signal?.reason ?? new Error("aborted"));
          };
          const start = () => {
            signal?.removeEventListener("abort", onAbort);
            resolve();
          };
          waiting.push(start);
          signal?.addEventListener("abort", onAbort, { once: true });
        });
      }
      try {
        return await task();
      } finally {
        release();
      }
    },
  };
}
