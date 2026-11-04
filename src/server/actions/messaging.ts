"use server";

import { z } from "zod";

import type { ActionResult } from "@/lib/action-result";
import { getAutomationDependencies } from "@/server/assistant/runtime";
import { recordAudit } from "@/server/audit";
import { processAssistantQueue } from "@/server/services/assistant";
import { runAutomationCycle, type AutomationSummary } from "@/server/services/automation";
import { cancelReminder, retryReminder } from "@/server/services/reminders";
import {
  markConversationRead,
  openConversationFor,
  sendTextMessage,
  simulateInboundMessage,
} from "@/server/services/whatsapp";
import { getWhatsAppProvider } from "@/server/whatsapp/provider";

import { auditContext } from "@/server/services/context";

import { runAction } from "./run-action";

const idSchema = z.uuid();
const messageBodySchema = z
  .string({ error: "Escreva a mensagem." })
  .trim()
  .min(1, { error: "Escreva a mensagem." })
  .max(4096, { error: "Mensagem muito longa (máximo de 4.096 caracteres)." });

export async function openConversationAction(subject: {
  patientId?: string;
  leadId?: string;
}): Promise<ActionResult<{ id: string }>> {
  return runAction(
    "whatsapp:read",
    async ({ db, actor }) => {
      const parsed = z
        .object({ patientId: idSchema.optional(), leadId: idSchema.optional() })
        .refine((value) => value.patientId || value.leadId)
        .parse(subject);
      return openConversationFor(db, actor, parsed);
    },
    { refresh: false },
  );
}

export async function sendMessageAction(conversationId: string, body: string): Promise<ActionResult<{ simulated: boolean }>> {
  return runAction("whatsapp:send", async ({ db, actor }) => {
    const text = messageBodySchema.parse(body);
    const result = await sendTextMessage(db, getWhatsAppProvider(), actor, idSchema.parse(conversationId), text);
    return { simulated: result.status === "SIMULATED" };
  });
}

export async function simulateInboundAction(conversationId: string, body: string): Promise<ActionResult<null>> {
  return runAction(
    "whatsapp:send",
    async ({ db, actor }) => {
      const text = messageBodySchema.parse(body);
      const id = idSchema.parse(conversationId);
      await simulateInboundMessage(db, getWhatsAppProvider(), actor, id, text);
      // Em desenvolvimento o assistente responde na hora (no webhook real, logo após a resposta à Meta).
      await processAssistantQueue(db, getAutomationDependencies(), { conversationId: id });
      return null;
    },
    { message: "Mensagem recebida simulada." },
  );
}

export async function markConversationReadAction(conversationId: string): Promise<ActionResult<null>> {
  return runAction("whatsapp:read", async ({ db, actor }) => {
    await markConversationRead(db, actor, idSchema.parse(conversationId));
    return null;
  });
}

/** "Processar agora": o mesmo ciclo do agendador (lembretes, acompanhamento, assistente, reenvios). */
export async function processReminderQueueAction(): Promise<ActionResult<AutomationSummary>> {
  return runAction("reminders:process", async ({ db, actor }) => {
    const summary = await runAutomationCycle(db, getAutomationDependencies());
    await recordAudit(db, {
      ...auditContext(actor),
      action: "reminders.process",
      metadata: {
        processed: summary.reminders.claimed,
        failed: summary.reminders.failed,
        assistantRuns: summary.assistant.claimed,
        tasks: summary.reminders.tasks,
      },
    });
    return summary;
  });
}

export async function cancelReminderAction(reminderId: string): Promise<ActionResult<null>> {
  return runAction(
    "returns:write",
    async ({ db, actor }) => {
      await cancelReminder(db, actor, idSchema.parse(reminderId));
      return null;
    },
    { message: "Lembrete cancelado." },
  );
}

export async function retryReminderAction(reminderId: string): Promise<ActionResult<null>> {
  return runAction(
    "returns:write",
    async ({ db, actor }) => {
      await retryReminder(db, actor, idSchema.parse(reminderId));
      return null;
    },
    { message: "Lembrete recolocado na fila." },
  );
}
