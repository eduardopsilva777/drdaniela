import "server-only";

import type { TemplateCategory, TemplateStatus, TemplateUsage } from "@/generated/prisma/enums";
import type { TemplateParameter } from "@/lib/labels";
import type { TemplateInput } from "@/lib/validation/assistant";
import { recordAudit } from "@/server/audit";
import type { DbClient, DbExecutor } from "@/server/db/prisma";
import { DomainError, isUniqueViolation, NotFoundError } from "@/server/errors";
import { logger } from "@/server/logger";

import { assertPermission, auditContext, type Actor } from "./context";

/**
 * Modelos de mensagem (templates) da Meta — os únicos permitidos fora da janela
 * de 24 horas. O CRM guarda o nome exato, o idioma, a categoria, o uso e o
 * significado de cada parâmetro; a situação (aprovado, recusado…) vem da Meta
 * (sincronização ou webhook) ou é registrada manualmente pela administração.
 * Só modelos APROVADOS são usados nos envios automáticos.
 */

export interface ResolvedTemplate {
  id: string | null;
  name: string;
  language: string;
  category: TemplateCategory;
  parameters: TemplateParameter[];
  /** Prévia exibida no CRM (com os parâmetros preenchidos). */
  body: string | null;
}

/** Modelos configurados por variável de ambiente (versão anterior): ordem fixa dos parâmetros. */
const LEGACY_PARAMETERS: Record<"APPOINTMENT_REMINDER" | "RETURN_REMINDER", TemplateParameter[]> = {
  APPOINTMENT_REMINDER: ["patient_name", "appointment_date", "appointment_time", "procedure_name"],
  RETURN_REMINDER: ["patient_name", "procedure_name", "due_date"],
};

export interface TemplateFallbacks {
  language: string;
  appointmentReminder?: string;
  returnReminder?: string;
  /** Adaptador de desenvolvimento: aceita um modelo simulado quando nenhum está aprovado. */
  developmentFallback: boolean;
}

/**
 * Modelo aprovado para um uso. Com `templateId` (regra de acompanhamento),
 * exige aquele modelo específico — e aprovado.
 */
export async function resolveTemplate(
  db: DbExecutor,
  usage: TemplateUsage,
  fallbacks: TemplateFallbacks,
  templateId?: string | null,
): Promise<ResolvedTemplate | { error: string }> {
  if (templateId) {
    const template = await db.messageTemplate.findUnique({ where: { id: templateId } });
    if (!template) return { error: "Modelo da regra de acompanhamento não encontrado." };
    if (template.status !== "APPROVED") {
      if (fallbacks.developmentFallback) return { ...toResolved(template), name: `${template.name} (simulado)` };
      return { error: `Modelo “${template.name}” não está aprovado pela Meta.` };
    }
    return toResolved(template);
  }

  const approved = await db.messageTemplate.findFirst({
    where: { usage, status: "APPROVED" },
    orderBy: { statusUpdatedAt: "desc" },
  });
  if (approved) return toResolved(approved);

  const legacyName =
    usage === "APPOINTMENT_REMINDER" ? fallbacks.appointmentReminder : usage === "RETURN_REMINDER" ? fallbacks.returnReminder : undefined;
  if (legacyName && usage !== "FOLLOW_UP") {
    return { id: null, name: legacyName, language: fallbacks.language, category: "UTILITY", parameters: LEGACY_PARAMETERS[usage], body: null };
  }
  if (fallbacks.developmentFallback && usage !== "FOLLOW_UP") {
    return {
      id: null,
      name: "lembrete_desenvolvimento",
      language: fallbacks.language,
      category: "UTILITY",
      parameters: LEGACY_PARAMETERS[usage],
      body: null,
    };
  }
  return { error: "Nenhum modelo aprovado pela Meta para este tipo de mensagem (Assistente › Modelos)." };
}

function toResolved(template: {
  id: string;
  name: string;
  language: string;
  category: TemplateCategory;
  parameters: string[];
  body: string;
}): ResolvedTemplate {
  return {
    id: template.id,
    name: template.name,
    language: template.language,
    category: template.category,
    parameters: template.parameters as TemplateParameter[],
    body: template.body,
  };
}

/** Preenche {{1}}, {{2}}… para a prévia registrada no CRM. */
export function renderTemplatePreview(body: string, values: string[]): string {
  return body.replace(/\{\{(\d+)\}\}/g, (_, index: string) => values[Number(index) - 1] ?? "");
}

export async function saveTemplate(db: DbClient, actor: Actor, templateId: string | null, input: TemplateInput) {
  assertPermission(actor, "assistant:configure");
  try {
    return await db.$transaction(async (tx) => {
      if (templateId) {
        const current = await tx.messageTemplate.findUnique({ where: { id: templateId }, select: { id: true, name: true, language: true } });
        if (!current) throw new NotFoundError("Modelo");
        const renamed = current.name !== input.name || current.language !== input.language;
        const template = await tx.messageTemplate.update({
          where: { id: templateId },
          data: {
            name: input.name,
            language: input.language,
            category: input.category,
            usage: input.usage,
            body: input.body,
            parameters: input.parameters,
            // Outro nome/idioma é outro modelo na Meta: a aprovação anterior não vale.
            ...(renamed ? { status: "DRAFT" as const, statusSource: "manual", statusUpdatedAt: new Date(), metaTemplateId: null } : {}),
          },
        });
        await recordAudit(tx, { ...auditContext(actor), action: "template.update", entityType: "message_template", entityId: templateId });
        return template;
      }
      const template = await tx.messageTemplate.create({
        data: {
          name: input.name,
          language: input.language,
          category: input.category,
          usage: input.usage,
          body: input.body,
          parameters: input.parameters,
          status: "DRAFT",
        },
      });
      await recordAudit(tx, { ...auditContext(actor), action: "template.create", entityType: "message_template", entityId: template.id });
      return template;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new DomainError("Já existe um modelo com este nome e idioma.", { fieldErrors: { name: ["Nome já cadastrado neste idioma."] } });
    }
    throw error;
  }
}

/** Registro manual da situação (ex.: aprovado no painel da Meta sem webhook configurado). */
export async function setTemplateStatus(
  db: DbClient,
  actor: Actor,
  templateId: string,
  input: { status: TemplateStatus; reason?: string },
) {
  assertPermission(actor, "assistant:configure");
  return db.$transaction(async (tx) => {
    const template = await tx.messageTemplate.findUnique({ where: { id: templateId }, select: { id: true, status: true } });
    if (!template) throw new NotFoundError("Modelo");
    await tx.messageTemplate.update({
      where: { id: templateId },
      data: {
        status: input.status,
        statusSource: "manual",
        statusUpdatedAt: new Date(),
        rejectionReason: input.status === "REJECTED" ? (input.reason ?? null) : null,
      },
    });
    await recordAudit(tx, {
      ...auditContext(actor),
      action: "template.status.update",
      entityType: "message_template",
      entityId: templateId,
      metadata: { from: template.status, to: input.status, source: "manual" },
    });
  });
}

const META_STATUS: Record<string, TemplateStatus> = {
  APPROVED: "APPROVED",
  PENDING: "PENDING",
  IN_APPEAL: "PENDING",
  REJECTED: "REJECTED",
  PAUSED: "PAUSED",
  LIMIT_EXCEEDED: "PAUSED",
  DISABLED: "DISABLED",
  PENDING_DELETION: "DISABLED",
  DELETED: "DISABLED",
};

/** Atualização de situação recebida da Meta (webhook `message_template_status_update` ou sincronização). */
export async function applyTemplateStatusFromMeta(
  db: DbExecutor,
  update: { name: string; language: string | null; event: string; reason: string | null; metaTemplateId: string | null },
) {
  const status = META_STATUS[update.event.toUpperCase()];
  if (!status) return { updated: 0 };
  const result = await db.messageTemplate.updateMany({
    where: { name: update.name, ...(update.language ? { language: update.language } : {}) },
    data: {
      status,
      statusSource: "meta",
      statusUpdatedAt: new Date(),
      rejectionReason: status === "REJECTED" && update.reason && update.reason !== "NONE" ? update.reason.slice(0, 300) : null,
      ...(update.metaTemplateId ? { metaTemplateId: update.metaTemplateId.slice(0, 64) } : {}),
    },
  });
  return { updated: result.count };
}

export interface MetaSyncConfig {
  graphApiVersion: string;
  businessAccountId: string;
  accessToken: string;
  fetchImpl?: typeof fetch;
}

/**
 * Consulta a situação dos modelos na Meta (somente leitura) e atualiza os já
 * cadastrados no CRM com o mesmo nome e idioma. Não cria nem envia modelos.
 */
export async function syncTemplatesFromMeta(db: DbClient, actor: Actor, config: MetaSyncConfig) {
  assertPermission(actor, "assistant:configure");
  const fetchImpl = config.fetchImpl ?? fetch;
  const url = new URL(`https://graph.facebook.com/${config.graphApiVersion}/${encodeURIComponent(config.businessAccountId)}/message_templates`);
  url.searchParams.set("fields", "name,language,status,category,rejected_reason,id");
  url.searchParams.set("limit", "200");

  let response: Response;
  try {
    response = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${config.accessToken}` },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new DomainError("Não foi possível consultar a Meta agora. Tente novamente em instantes.");
  }
  if (!response.ok) {
    logger.warn("whatsapp.templates.sync_failed", { httpStatus: response.status });
    throw new DomainError(
      response.status === 401 || response.status === 403
        ? "A Meta recusou a credencial (WHATSAPP_ACCESS_TOKEN) para consultar os modelos."
        : "A Meta recusou a consulta dos modelos.",
    );
  }
  const body = (await response.json().catch(() => null)) as {
    data?: Array<{ name?: string; language?: string; status?: string; rejected_reason?: string; id?: string }>;
  } | null;

  let updated = 0;
  for (const item of body?.data ?? []) {
    if (!item.name || !item.status) continue;
    const result = await applyTemplateStatusFromMeta(db, {
      name: item.name,
      language: item.language ?? null,
      event: item.status,
      reason: item.rejected_reason ?? null,
      metaTemplateId: item.id ?? null,
    });
    updated += result.updated;
  }
  await recordAudit(db, { ...auditContext(actor), action: "template.sync", metadata: { received: body?.data?.length ?? 0, updated } });
  return { received: body?.data?.length ?? 0, updated };
}
