import Anthropic from "@anthropic-ai/sdk";

import { classifyAnthropicError } from "../anthropic-model";
import { AssistantModelError } from "../types";

import type { AgentMessage, AgentModel, AgentRequest, AgentResponse, AgentStopReason, AgentTextBlock, AgentToolCall } from "./types";

/**
 * Provedor Anthropic (SDK oficial) para o agente conversacional.
 *
 * - Ferramentas com `strict: true` (argumentos sempre no schema) e resposta
 *   final em JSON Schema (`output_config.format`): texto ao contato + sinais.
 * - Instruções fixas com cache de prompt (identidade e regras se repetem em
 *   todas as conversas); o contexto de cada contato vai nas mensagens.
 * - Recusa por política: o servidor da Anthropic tenta o modelo indicado
 *   (`fallbacks: "default"`).
 * - O conteúdo devolvido pelo modelo (inclusive blocos de raciocínio) volta
 *   sem alteração nas chamadas seguintes do mesmo turno.
 * - Novas tentativas do SDK para falhas temporárias; o turno inteiro é
 *   limitado pelo `signal` do orquestrador.
 */

export interface AnthropicAgentOptions {
  apiKey?: string;
  model: string;
  effort: "low" | "medium" | "high";
  /** Pior caso do turno (reserva da conversa na fila). */
  turnTimeoutMs: number;
  /** Permite injetar um cliente nos testes. */
  client?: Anthropic;
}

const SDK_MAX_RETRIES = 2;

function toAnthropicMessages(messages: AgentMessage[]): Anthropic.Beta.BetaMessageParam[] {
  return messages.map((message): Anthropic.Beta.BetaMessageParam => {
    if (message.role === "assistant") {
      if (message.providerContent) {
        return { role: "assistant", content: message.providerContent as Anthropic.Beta.BetaContentBlockParam[] };
      }
      return {
        role: "assistant",
        content: message.content.map((block): Anthropic.Beta.BetaContentBlockParam =>
          block.type === "text"
            ? { type: "text", text: block.text }
            : { type: "tool_use", id: block.id, name: block.name, input: block.input as Record<string, unknown> },
        ),
      };
    }
    return {
      role: "user",
      content: message.content.map((block): Anthropic.Beta.BetaContentBlockParam =>
        block.type === "text"
          ? { type: "text", text: block.text }
          : { type: "tool_result", tool_use_id: block.toolCallId, content: block.content, is_error: block.isError },
      ),
    };
  });
}

function stopReasonOf(reason: string | null): AgentStopReason {
  switch (reason) {
    case "end_turn":
    case "stop_sequence":
      return "end_turn";
    case "tool_use":
      return "tool_use";
    case "max_tokens":
    case "model_context_window_exceeded":
      return "max_tokens";
    case "refusal":
      return "refusal";
    default:
      return "other";
  }
}

export class AnthropicAgentModel implements AgentModel {
  readonly name: string;
  readonly maxLatencyMs: number;
  private readonly client: Anthropic;
  private readonly options: AnthropicAgentOptions;

  constructor(options: AnthropicAgentOptions) {
    this.options = options;
    this.name = `anthropic:${options.model}`;
    this.maxLatencyMs = options.turnTimeoutMs;
    this.client = options.client ?? new Anthropic({ apiKey: options.apiKey, maxRetries: SDK_MAX_RETRIES });
  }

  async complete(request: AgentRequest): Promise<AgentResponse> {
    let response: Anthropic.Beta.BetaMessage;
    try {
      response = await this.client.beta.messages.create(
        {
          model: this.options.model,
          max_tokens: request.maxOutputTokens,
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          output_config: {
            effort: this.options.effort,
            format: { type: "json_schema", schema: request.outputSchema },
          },
          system: [{ type: "text", text: request.system, cache_control: { type: "ephemeral" } }],
          tools: request.tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            input_schema: tool.inputSchema as Anthropic.Beta.BetaTool.InputSchema,
            strict: true,
          })),
          messages: toAnthropicMessages(request.messages),
        },
        { timeout: request.timeoutMs, signal: request.signal ?? undefined },
      );
    } catch (error) {
      if (error instanceof Anthropic.APIUserAbortError) {
        throw new AssistantModelError("Tempo do turno esgotado.", "turn_timeout", true);
      }
      throw classifyAnthropicError(error);
    }

    const content: Array<AgentTextBlock | AgentToolCall> = [];
    for (const block of response.content) {
      if (block.type === "text") content.push({ type: "text", text: block.text });
      else if (block.type === "tool_use") content.push({ type: "tool_call", id: block.id, name: block.name, input: block.input });
    }
    return {
      content,
      providerContent: response.content,
      stopReason: stopReasonOf(response.stop_reason),
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
      },
      model: response.model,
    };
  }
}
