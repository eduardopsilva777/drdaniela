import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { assistantConfigSchema, resolveAssistantConfig, type AssistantConfig } from "@/lib/assistant-config";
import { recordAudit } from "@/server/audit";
import type { DbClient, DbExecutor } from "@/server/db/prisma";
import { DomainError } from "@/server/errors";

import { assertPermission, auditContext, type Actor } from "./context";

/** Configurações do assistente (linha única), sempre completadas com os padrões. */
export async function getAssistantConfig(db: DbExecutor): Promise<AssistantConfig> {
  const row = await db.assistantSettings.findUnique({ where: { id: "default" }, select: { config: true } });
  return resolveAssistantConfig(row?.config);
}

export async function getAssistantSettingsMeta(db: DbExecutor) {
  return db.assistantSettings.findUnique({
    where: { id: "default" },
    select: { updatedAt: true, updatedBy: { select: { name: true } } },
  });
}

export async function saveAssistantConfig(db: DbClient, actor: Actor, input: unknown): Promise<AssistantConfig> {
  assertPermission(actor, "assistant:configure");
  const config = assistantConfigSchema.parse(input);

  if (config.booking.enabled) {
    if (!config.booking.procedureId) {
      throw new DomainError("Escolha o procedimento que o assistente pode agendar.", {
        fieldErrors: { "booking.procedureId": ["Escolha o procedimento."] },
      });
    }
    if (config.booking.professionalIds.length === 0) {
      throw new DomainError("Escolha ao menos uma profissional para os agendamentos do assistente.", {
        fieldErrors: { "booking.professionalIds": ["Escolha ao menos uma profissional."] },
      });
    }
    if (config.booking.weeklyHours.every((ranges) => ranges.length === 0)) {
      throw new DomainError("Informe ao menos um horário de atendimento para o agendamento pelo assistente.");
    }
  }
  if (config.booking.procedureId) {
    const procedure = await db.procedure.findFirst({ where: { id: config.booking.procedureId, isActive: true }, select: { id: true } });
    if (!procedure) throw new DomainError("Procedimento de agendamento inválido ou inativo.");
  }
  if (config.booking.professionalIds.length > 0) {
    const count = await db.user.count({
      where: { id: { in: config.booking.professionalIds }, isActive: true, role: { in: ["PROFESSIONAL", "ADMIN"] } },
    });
    if (count !== new Set(config.booking.professionalIds).size) {
      throw new DomainError("Uma das profissionais escolhidas está inativa ou não pode atender.");
    }
  }
  if (config.proactive.startTime >= config.proactive.endTime) {
    throw new DomainError("O horário final das mensagens automáticas deve ser depois do inicial.");
  }

  const previous = await getAssistantConfig(db);
  const changed = (Object.keys(config) as Array<keyof AssistantConfig>).filter(
    (key) => JSON.stringify(previous[key]) !== JSON.stringify(config[key]),
  );

  await db.$transaction(async (tx) => {
    await tx.assistantSettings.upsert({
      where: { id: "default" },
      create: { id: "default", config: config as unknown as Prisma.InputJsonValue, updatedById: actor.id },
      update: { config: config as unknown as Prisma.InputJsonValue, updatedById: actor.id },
    });
    await recordAudit(tx, {
      ...auditContext(actor),
      action: "assistant.settings.update",
      entityType: "assistant_settings",
      entityId: "default",
      metadata: { sections: changed.join(",") || "nenhuma", enabled: config.enabled, booking: config.booking.enabled },
    });
  });
  return config;
}
