import "server-only";

import { getContentKeyring } from "@/server/crypto/content-key";
import { getServerEnv, type ServerEnv } from "@/server/env";
import type { AutomationDependencies } from "@/server/services/automation";
import { getWhatsAppProvider } from "@/server/whatsapp/provider";

import { AnthropicAgentModel } from "./agent/anthropic";
import { createConcurrencyLimiter, type AgentRuntime } from "./agent/types";
import { AnthropicAssistantModel } from "./anthropic-model";
import { RulesAssistantModel } from "./rules-model";
import type { AssistantModel } from "./types";

/**
 * Motor de interpretação conforme AI_PROVIDER (null = assistente desativado).
 * Com a IA generativa (AI_ENGINE=agent), este é o motor por regras: atende
 * quando o limite mensal de gasto é atingido.
 */
export function createAssistantModel(env: ServerEnv): AssistantModel | null {
  if (env.AI_PROVIDER === "disabled") return null;
  if (env.AI_PROVIDER === "anthropic" && env.AI_ENGINE === "guided") {
    return new AnthropicAssistantModel({
      apiKey: env.ANTHROPIC_API_KEY,
      model: env.ANTHROPIC_MODEL,
      effort: env.AI_EFFORT,
      timeoutMs: env.AI_TIMEOUT_MS,
    });
  }
  return new RulesAssistantModel();
}

let cachedModel: { model: AssistantModel | null } | undefined;

export function getAssistantModel(): AssistantModel | null {
  cachedModel ??= { model: createAssistantModel(getServerEnv()) };
  return cachedModel.model;
}

/** IA generativa com ferramentas do CRM (AI_PROVIDER=anthropic e AI_ENGINE=agent). */
export function createAgentRuntime(env: ServerEnv): AgentRuntime | null {
  if (env.AI_PROVIDER !== "anthropic" || env.AI_ENGINE !== "agent") return null;
  return {
    model: new AnthropicAgentModel({
      apiKey: env.ANTHROPIC_API_KEY,
      model: env.ANTHROPIC_MODEL,
      effort: env.AI_EFFORT,
      turnTimeoutMs: env.AI_TURN_TIMEOUT_MS,
    }),
    pricing: {
      inputPerMTok: env.AI_PRICE_INPUT_PER_MTOK,
      outputPerMTok: env.AI_PRICE_OUTPUT_PER_MTOK,
      cacheReadPerMTok: env.AI_PRICE_CACHE_READ_PER_MTOK,
      cacheWritePerMTok: env.AI_PRICE_CACHE_WRITE_PER_MTOK,
    },
    maxOutputTokens: env.AI_MAX_OUTPUT_TOKENS,
    callTimeoutMs: env.AI_TIMEOUT_MS,
    turnTimeoutMs: env.AI_TURN_TIMEOUT_MS,
    limiter: createConcurrencyLimiter(env.AI_MAX_CONCURRENCY),
  };
}

let cachedAgent: { agent: AgentRuntime | null } | undefined;

export function getAgentRuntime(): AgentRuntime | null {
  cachedAgent ??= { agent: createAgentRuntime(getServerEnv()) };
  return cachedAgent.agent;
}

export interface AssistantEngineStatus {
  provider: ServerEnv["AI_PROVIDER"];
  title: string;
  description: string;
  model: string | null;
}

/** Situação do motor exibida na interface — nunca expõe credenciais. */
export function getAssistantEngineStatus(): AssistantEngineStatus {
  const env = getServerEnv();
  switch (env.AI_PROVIDER) {
    case "anthropic":
      return env.AI_ENGINE === "agent"
        ? {
            provider: "anthropic",
            title: "IA conversacional (Claude)",
            description:
              "Cada resposta é gerada pela IA a partir da personalidade configurada, do contexto do contato e da base aprovada; ações no CRM passam por ferramentas validadas pelo servidor. Trechos mascarados das conversas são enviados à Anthropic.",
            model: env.ANTHROPIC_MODEL,
          }
        : {
            provider: "anthropic",
            title: "IA guiada (Claude)",
            description:
              "Claude interpreta as mensagens e redige respostas só com a base aprovada; o roteiro e os textos são os configurados. Trechos mascarados das conversas são enviados à Anthropic.",
            model: env.ANTHROPIC_MODEL,
          };
    case "rules":
      return {
        provider: "rules",
        title: "Motor por regras (sem IA generativa)",
        description:
          "Respostas são exatamente os textos aprovados da base de conhecimento, escolhidos por palavras-chave. Nada sai do servidor.",
        model: null,
      };
    default:
      return {
        provider: "disabled",
        title: "Assistente desativado",
        description:
          "Ninguém responde automaticamente: as conversas ficam com a equipe. Descadastros (PARAR) continuam sendo processados.",
        model: null,
      };
  }
}

/** Dependências do ciclo de automação a partir do ambiente. */
export function getAutomationDependencies(): AutomationDependencies {
  const env = getServerEnv();
  return {
    provider: getWhatsAppProvider(),
    model: getAssistantModel(),
    agent: getAgentRuntime(),
    timeZone: env.APP_TIMEZONE,
    language: env.WHATSAPP_TEMPLATE_LANGUAGE,
    templates: {
      returnReminder: env.WHATSAPP_TEMPLATE_RETURN_REMINDER,
      appointmentReminder: env.WHATSAPP_TEMPLATE_APPOINTMENT_REMINDER,
    },
    keyring: getContentKeyring(),
    reminderSettings: {
      appointmentHoursBefore: env.REMINDER_APPOINTMENT_HOURS_BEFORE,
      returnDaysBefore: env.REMINDER_RETURN_DAYS_BEFORE,
      sendTime: "09:00",
    },
  };
}
