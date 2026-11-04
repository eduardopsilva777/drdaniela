"use server";

import { z } from "zod";

import type { ActionResult } from "@/lib/action-result";
import {
  gapFeedbackSchema,
  knowledgeEntryInputSchema,
  knowledgeRejectSchema,
  knowledgeReviewSchema,
  knowledgeTestSchema,
  templateInputSchema,
  templateStatusSchema,
} from "@/lib/validation/assistant";
import { formDataToObject, uuidSchema } from "@/lib/validation/common";
import { getAssistantModel } from "@/server/assistant/runtime";
import { RulesAssistantModel } from "@/server/assistant/rules-model";
import { getContentKeyring } from "@/server/crypto/content-key";
import { getServerEnv } from "@/server/env";
import { DomainError } from "@/server/errors";
import { getKnowledgeHistory } from "@/server/queries/assistant";
import { saveAssistantConfig } from "@/server/services/assistant-settings";
import {
  approveKnowledgeVersion,
  createKnowledgeEntry,
  createKnowledgeVersion,
  dismissKnowledgeGap,
  rejectKnowledgeVersion,
  reportAssistantReply,
  setKnowledgeEntryArchived,
  submitKnowledgeVersion,
} from "@/server/services/knowledge";
import { testKnowledgeQuestion, type KnowledgeTestResult } from "@/server/services/knowledge-test";
import { cancelReturnSequence, pauseReturnSequence, resumeReturnSequence } from "@/server/services/reminders";
import { cancelTask, completeTask } from "@/server/services/tasks";
import { saveTemplate, setTemplateStatus, syncTemplatesFromMeta } from "@/server/services/templates";
import { eraseConversationContent, setConversationMode } from "@/server/services/whatsapp";

import { runAction } from "./run-action";

/** Ações da área do assistente virtual, base de conhecimento, modelos e tarefas. */

// -----------------------------------------------------------------------------
// Conversas
// -----------------------------------------------------------------------------

export async function setConversationModeAction(conversationId: string, mode: string): Promise<ActionResult<null>> {
  return runAction(
    "whatsapp:send",
    async ({ db, actor }) => {
      await setConversationMode(db, actor, uuidSchema.parse(conversationId), z.enum(["ASSISTANT", "HUMAN"]).parse(mode));
      return null;
    },
    { message: mode === "ASSISTANT" ? "O assistente voltou a responder esta conversa." : "A equipe assumiu esta conversa." },
  );
}

export async function reportAssistantReplyAction(messageId: string, formData: FormData): Promise<ActionResult<null>> {
  return runAction(
    "knowledge:write",
    async ({ db, actor }) => {
      const { note } = gapFeedbackSchema.parse(formDataToObject(formData));
      await reportAssistantReply(db, actor, getContentKeyring(), uuidSchema.parse(messageId), note);
      return null;
    },
    { message: "Resposta enviada para revisão da base de conhecimento." },
  );
}

export async function eraseConversationAction(conversationId: string): Promise<ActionResult<null>> {
  return runAction(
    "whatsapp:erase",
    async ({ db, actor }) => {
      await eraseConversationContent(db, actor, uuidSchema.parse(conversationId));
      return null;
    },
    { message: "Conteúdo da conversa apagado. O histórico de consentimento foi mantido." },
  );
}

// -----------------------------------------------------------------------------
// Base de conhecimento
// -----------------------------------------------------------------------------

export async function saveKnowledgeEntryAction(entryId: string | null, formData: FormData): Promise<ActionResult<{ entryId: string }>> {
  return runAction(
    "knowledge:write",
    async ({ db, actor }) => {
      const input = knowledgeEntryInputSchema.parse(formDataToObject(formData));
      const result = entryId
        ? await createKnowledgeVersion(db, actor, uuidSchema.parse(entryId), input)
        : await createKnowledgeEntry(db, actor, input);
      return { entryId: result.entryId };
    },
    { message: "Resposta registrada. Ela só chega aos contatos depois de aprovada." },
  );
}

export async function submitKnowledgeVersionAction(versionId: string): Promise<ActionResult<null>> {
  return runAction(
    "knowledge:write",
    async ({ db, actor }) => {
      await submitKnowledgeVersion(db, actor, uuidSchema.parse(versionId));
      return null;
    },
    { message: "Enviada para aprovação." },
  );
}

export async function approveKnowledgeVersionAction(versionId: string, formData: FormData): Promise<ActionResult<null>> {
  return runAction(
    "knowledge:approve",
    async ({ db, actor }) => {
      const { note } = knowledgeReviewSchema.parse(formDataToObject(formData));
      await approveKnowledgeVersion(db, actor, uuidSchema.parse(versionId), note);
      return null;
    },
    { message: "Resposta aprovada e publicada para o assistente." },
  );
}

export async function rejectKnowledgeVersionAction(versionId: string, formData: FormData): Promise<ActionResult<null>> {
  return runAction(
    "knowledge:approve",
    async ({ db, actor }) => {
      const { note } = knowledgeRejectSchema.parse(formDataToObject(formData));
      await rejectKnowledgeVersion(db, actor, uuidSchema.parse(versionId), note);
      return null;
    },
    { message: "Versão recusada." },
  );
}

export async function setKnowledgeArchivedAction(entryId: string, archived: boolean): Promise<ActionResult<null>> {
  return runAction(
    "knowledge:approve",
    async ({ db, actor }) => {
      await setKnowledgeEntryArchived(db, actor, uuidSchema.parse(entryId), archived === true);
      return null;
    },
    { message: archived ? "Entrada arquivada: o assistente deixou de usá-la." : "Entrada restaurada." },
  );
}

export async function dismissKnowledgeGapAction(gapId: string): Promise<ActionResult<null>> {
  return runAction(
    "knowledge:write",
    async ({ db, actor }) => {
      await dismissKnowledgeGap(db, actor, uuidSchema.parse(gapId));
      return null;
    },
    { message: "Pendência descartada." },
  );
}

export async function getKnowledgeHistoryAction(entryId: string) {
  return runAction(
    "knowledge:read",
    async () => {
      const versions = await getKnowledgeHistory(uuidSchema.parse(entryId));
      return versions.map((version) => ({
        ...version,
        createdAt: version.createdAt.toISOString(),
        reviewedAt: version.reviewedAt?.toISOString() ?? null,
      }));
    },
    { refresh: false },
  );
}

export async function testKnowledgeQuestionAction(formData: FormData): Promise<ActionResult<KnowledgeTestResult>> {
  return runAction(
    "knowledge:write",
    async ({ db, actor }) => {
      const input = knowledgeTestSchema.parse(formDataToObject(formData));
      // Com o assistente desativado, o teste usa o motor por regras (nada sai do servidor).
      const model = getAssistantModel() ?? new RulesAssistantModel();
      try {
        return await testKnowledgeQuestion(db, actor, model, input, { timeZone: getServerEnv().APP_TIMEZONE });
      } catch (error) {
        if (error instanceof DomainError) throw error;
        throw new DomainError("Não foi possível consultar o motor do assistente agora. Tente novamente em instantes.");
      }
    },
    { refresh: false },
  );
}

// -----------------------------------------------------------------------------
// Configurações e modelos
// -----------------------------------------------------------------------------

export async function saveAssistantSettingsAction(json: string): Promise<ActionResult<null>> {
  return runAction(
    "assistant:configure",
    async ({ db, actor }) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(json);
      } catch {
        throw new DomainError("Configurações em formato inválido.");
      }
      await saveAssistantConfig(db, actor, parsed);
      return null;
    },
    { message: "Configurações do assistente salvas." },
  );
}

/** Os parâmetros do modelo chegam como JSON num campo oculto. */
function parseTemplateForm(formData: FormData) {
  let parameters: unknown;
  try {
    parameters = JSON.parse(String(formData.get("parameters") ?? "[]"));
  } catch {
    throw new DomainError("Parâmetros do modelo em formato inválido.");
  }
  return templateInputSchema.parse({ ...formDataToObject(formData), parameters });
}

export async function saveTemplateAction(templateId: string | null, formData: FormData): Promise<ActionResult<null>> {
  return runAction(
    "assistant:configure",
    async ({ db, actor }) => {
      await saveTemplate(db, actor, templateId ? uuidSchema.parse(templateId) : null, parseTemplateForm(formData));
      return null;
    },
    { message: templateId ? "Modelo atualizado." : "Modelo cadastrado como rascunho. Submeta-o na Meta e registre a aprovação." },
  );
}

export async function setTemplateStatusAction(templateId: string, formData: FormData): Promise<ActionResult<null>> {
  return runAction(
    "assistant:configure",
    async ({ db, actor }) => {
      await setTemplateStatus(db, actor, uuidSchema.parse(templateId), templateStatusSchema.parse(formDataToObject(formData)));
      return null;
    },
    { message: "Situação do modelo atualizada." },
  );
}

export async function syncTemplatesAction(): Promise<ActionResult<{ received: number; updated: number }>> {
  return runAction("assistant:configure", async ({ db, actor }) => {
    const env = getServerEnv();
    if (env.WHATSAPP_PROVIDER !== "cloud_api" || !env.WHATSAPP_BUSINESS_ACCOUNT_ID || !env.WHATSAPP_ACCESS_TOKEN) {
      throw new DomainError(
        "Sincronização indisponível: requer WHATSAPP_PROVIDER=cloud_api, WHATSAPP_BUSINESS_ACCOUNT_ID e WHATSAPP_ACCESS_TOKEN.",
      );
    }
    return syncTemplatesFromMeta(db, actor, {
      graphApiVersion: env.WHATSAPP_GRAPH_API_VERSION,
      businessAccountId: env.WHATSAPP_BUSINESS_ACCOUNT_ID,
      accessToken: env.WHATSAPP_ACCESS_TOKEN,
    });
  });
}

// -----------------------------------------------------------------------------
// Tarefas e sequências de acompanhamento
// -----------------------------------------------------------------------------

export async function completeTaskAction(taskId: string): Promise<ActionResult<null>> {
  return runAction(
    "tasks:work",
    async ({ db, actor }) => {
      await completeTask(db, actor, uuidSchema.parse(taskId));
      return null;
    },
    { message: "Tarefa concluída." },
  );
}

export async function cancelTaskAction(taskId: string): Promise<ActionResult<null>> {
  return runAction(
    "tasks:work",
    async ({ db, actor }) => {
      await cancelTask(db, actor, uuidSchema.parse(taskId));
      return null;
    },
    { message: "Tarefa cancelada." },
  );
}

export async function pauseSequenceAction(returnId: string): Promise<ActionResult<null>> {
  return runAction(
    "returns:write",
    async ({ db, actor }) => {
      await pauseReturnSequence(db, actor, uuidSchema.parse(returnId));
      return null;
    },
    { message: "Sequência de acompanhamento pausada." },
  );
}

export async function resumeSequenceAction(returnId: string): Promise<ActionResult<null>> {
  return runAction(
    "returns:write",
    async ({ db, actor }) => {
      await resumeReturnSequence(db, actor, uuidSchema.parse(returnId));
      return null;
    },
    { message: "Sequência retomada." },
  );
}

export async function cancelSequenceAction(returnId: string): Promise<ActionResult<null>> {
  return runAction(
    "returns:write",
    async ({ db, actor }) => {
      await cancelReturnSequence(db, actor, uuidSchema.parse(returnId));
      return null;
    },
    { message: "Sequência cancelada." },
  );
}
