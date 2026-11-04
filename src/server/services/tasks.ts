import "server-only";

import type { TaskKind } from "@/generated/prisma/enums";
import { recordAudit } from "@/server/audit";
import type { DbClient, DbExecutor } from "@/server/db/prisma";
import { DomainError, NotFoundError } from "@/server/errors";

import { assertPermission, auditContext, type Actor } from "./context";

/**
 * Tarefas e avisos para a equipe: conversas encaminhadas pelo assistente,
 * oportunidades qualificadas, etapas de acompanhamento e falhas de automação.
 * A chave de deduplicação (índice único parcial) impede duas tarefas abertas
 * para o mesmo motivo — reprocessamentos não geram avisos repetidos.
 */

export interface TaskInput {
  kind: TaskKind;
  title: string;
  details?: string | null;
  urgent?: boolean;
  dueAt?: Date;
  dedupeKey?: string | null;
  conversationId?: string | null;
  leadId?: string | null;
  patientId?: string | null;
  returnId?: string | null;
  reminderId?: string | null;
}

/** Abre a tarefa, a menos que já exista uma aberta com a mesma chave. */
export async function openTask(db: DbExecutor, input: TaskInput): Promise<{ created: boolean }> {
  const result = await db.staffTask.createMany({
    data: [
      {
        kind: input.kind,
        title: input.title.slice(0, 160),
        details: input.details?.slice(0, 500) ?? null,
        urgent: input.urgent ?? false,
        dueAt: input.dueAt ?? new Date(),
        dedupeKey: input.dedupeKey?.slice(0, 120) ?? null,
        conversationId: input.conversationId ?? null,
        leadId: input.leadId ?? null,
        patientId: input.patientId ?? null,
        returnId: input.returnId ?? null,
        reminderId: input.reminderId ?? null,
      },
    ],
    skipDuplicates: true,
  });
  if (result.count === 0 && input.urgent && input.dedupeKey) {
    // Já havia tarefa aberta: uma urgência nova eleva a prioridade da existente.
    await db.staffTask.updateMany({ where: { dedupeKey: input.dedupeKey, status: "OPEN" }, data: { urgent: true } });
  }
  return { created: result.count === 1 };
}

async function closeTask(db: DbClient, actor: Actor, taskId: string, status: "DONE" | "CANCELLED", now: Date) {
  assertPermission(actor, "tasks:work");
  return db.$transaction(async (tx) => {
    const task = await tx.staffTask.findUnique({ where: { id: taskId }, select: { id: true, status: true, kind: true } });
    if (!task) throw new NotFoundError("Tarefa");
    if (task.status !== "OPEN") throw new DomainError("Esta tarefa já foi encerrada.");
    await tx.staffTask.update({
      where: { id: taskId },
      data: { status, completedAt: now, completedById: actor.id },
    });
    await recordAudit(tx, {
      ...auditContext(actor),
      action: status === "DONE" ? "task.complete" : "task.cancel",
      entityType: "staff_task",
      entityId: taskId,
      metadata: { kind: task.kind },
    });
  });
}

export function completeTask(db: DbClient, actor: Actor, taskId: string, now: Date = new Date()) {
  return closeTask(db, actor, taskId, "DONE", now);
}

export function cancelTask(db: DbClient, actor: Actor, taskId: string, now: Date = new Date()) {
  return closeTask(db, actor, taskId, "CANCELLED", now);
}

/** A equipe respondeu a conversa: o encaminhamento aberto está atendido. */
export async function completeHandoffTasks(db: DbExecutor, conversationId: string, actorId: string, now: Date) {
  return db.staffTask.updateMany({
    where: { conversationId, kind: "HANDOFF", status: "OPEN" },
    data: { status: "DONE", completedAt: now, completedById: actorId },
  });
}
