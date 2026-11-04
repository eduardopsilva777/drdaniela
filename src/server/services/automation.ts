import "server-only";

import type { AgentRuntime } from "@/server/assistant/agent/types";
import type { AssistantModel } from "@/server/assistant/types";
import type { Keyring } from "@/server/crypto/field-encryption";
import type { DbClient } from "@/server/db/prisma";
import type { WhatsAppProvider } from "@/server/whatsapp/types";

import { processAssistantQueue, type AssistantQueueSummary } from "./assistant";
import { getAssistantConfig } from "./assistant-settings";
import { scheduleFollowUps, type FollowUpScheduleSummary } from "./follow-ups";
import { processReminderQueue, type QueueSummary, type ReminderSettings } from "./reminders";
import { retryAutomatedMessages } from "./whatsapp";

/**
 * Ciclo de automação, chamado pelo agendador (POST /api/jobs/automation) a
 * cada poucos minutos e pelo botão "Processar agora":
 * 1. Lembretes e etapas de acompanhamento vencidos (com horário permitido e limites).
 * 2. Recuperação de oportunidades: acompanhamentos da IA dentro da janela de 24h
 *    (se ativados) e tarefas para leads parados (`follow-ups.ts`).
 * 3. Execuções do assistente que ficaram pendentes (o webhook já processa na hora;
 *    aqui entram as reentregas, novas tentativas, recuperações e acompanhamentos).
 * 4. Reenvio de respostas automáticas que falharam temporariamente.
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
  /** IA generativa (AI_ENGINE=agent). */
  agent?: AgentRuntime | null;
}

export interface AutomationSummary {
  reminders: QueueSummary;
  followUps: FollowUpScheduleSummary;
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
  const followUps = await scheduleFollowUps(db, {
    now,
    timeZone: deps.timeZone,
    config,
    agentAvailable: Boolean(deps.agent && deps.provider),
  });
  const assistant = await processAssistantQueue(db, deps, { now });
  const messages = await retryAutomatedMessages(db, deps.provider, now, deps.keyring);
  return { reminders, followUps, assistant, messages };
}
