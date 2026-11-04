import "server-only";

import { getContentKeyring } from "@/server/crypto/content-key";
import { getServerEnv, type ServerEnv } from "@/server/env";
import type { AutomationDependencies } from "@/server/services/automation";
import { getWhatsAppProvider } from "@/server/whatsapp/provider";

import { AnthropicAssistantModel } from "./anthropic-model";
import { RulesAssistantModel } from "./rules-model";
import type { AssistantModel } from "./types";

/** Motor do assistente conforme AI_PROVIDER (null = assistente desativado). */
export function createAssistantModel(env: ServerEnv): AssistantModel | null {
  if (env.AI_PROVIDER === "disabled") return null;
  if (env.AI_PROVIDER === "anthropic") {
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
      return {
        provider: "anthropic",
        title: "IA generativa (Claude)",
        description:
          "Claude interpreta as mensagens e redige respostas só com a base aprovada. Trechos mascarados das conversas são enviados à Anthropic.",
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
