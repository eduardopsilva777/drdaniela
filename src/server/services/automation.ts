import "server-only";

import type { AssistantModel } from "@/server/assistant/types";
import type { Keyring } from "@/server/crypto/field-encryption";
import type { DbClient } from "@/server/db/prisma";
import type { WhatsAppProvider } from "@/server/whatsapp/types";

import { processAssistantQueue, type AssistantQueueSummary } from "./assistant";
import { getAssistantConfig } from "./assistant-settings";
import { processReminderQueue, type QueueSummary, type ReminderSettings } from "./reminders";
import { retryAutomatedMessages } from "./whatsapp";

/**
 * Ciclo de automação, chamado pelo agendador (POST /api/jobs/automation) a
 * cada poucos minutos e pelo botão "Processar agora":
 * 1. Lembretes e etapas de acompanhamento vencidos (com horário permitido e limites).
 * 2. Execuções do assistente que ficaram pendentes (o webhook já processa na hora;
 *    aqui entram as reentregas, novas tentativas e recuperações).
 * 3. Reenvio de respostas automáticas que falharam temporariamente.
 * Execuções simultâneas são seguras (reservas com SKIP LOCKED e condicionais).
 */

export interface AutomationDependencies {
  provider: WhatsAppProvider | null;
  model: AssistantModel | null;
  timeZone: string;
  language: string;
  templates: { returnReminder?: string; appointmentReminder?: string };
  keyring: Keyring | null;
  reminderSettings: ReminderSettings;
}

export interface AutomationSummary {
  reminders: QueueSummary;
  assistant: AssistantQueueSummary;
  messages: { retried: number; sent: number; failed: number };
}

export async function runAutomationCycle(
  db: DbClient,
  deps: AutomationDependencies,
  now: Date = new Date(),
): Promise<AutomationSummary> {
  const config = await getAssistantConfig(db);
  const reminders = await processReminderQueue(
    db,
    {
      provider: deps.provider,
      timeZone: deps.timeZone,
      language: deps.language,
      templates: deps.templates,
      proactive: config.proactive,
      clinicName: config.clinicName,
    },
    { now },
  );
  const assistant = await processAssistantQueue(db, deps, { now });
  const messages = await retryAutomatedMessages(db, deps.provider, now, deps.keyring);
  return { reminders, assistant, messages };
}
