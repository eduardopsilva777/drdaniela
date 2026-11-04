import "server-only";

import type { ProcedureInput } from "@/lib/validation/procedures";
import { recordAudit } from "@/server/audit";
import type { DbClient } from "@/server/db/prisma";
import { DomainError, isUniqueViolation, NotFoundError } from "@/server/errors";

import { assertPermission, auditContext, type Actor } from "./context";

/**
 * Catálogo de procedimentos. O intervalo de retorno é apenas o valor que a
 * profissional configurar — o sistema não sugere intervalos clínicos.
 */

function toData(input: ProcedureInput) {
  return {
    name: input.name,
    category: input.category ?? null,
    description: input.description ?? null,
    durationMinutes: input.durationMinutes,
    priceCents: input.price ?? null,
    suggestedReturnDays: input.suggestedReturnDays ?? null,
    color: input.color ?? null,
  };
}

function duplicateName(): DomainError {
  const message = "Já existe um procedimento com este nome.";
  return new DomainError(message, { fieldErrors: { name: [message] } });
}

export async function createProcedure(db: DbClient, actor: Actor, input: ProcedureInput) {
  assertPermission(actor, "procedures:manage");
  try {
    return await db.$transaction(async (tx) => {
      const procedure = await tx.procedure.create({ data: toData(input) });
      await recordAudit(tx, {
        ...auditContext(actor),
        action: "procedure.create",
        entityType: "procedure",
        entityId: procedure.id,
      });
      return procedure;
    });
  } catch (error) {
    if (isUniqueViolation(error, "name")) throw duplicateName();
    throw error;
  }
}

export async function updateProcedure(db: DbClient, actor: Actor, id: string, input: ProcedureInput) {
  assertPermission(actor, "procedures:manage");
  try {
    return await db.$transaction(async (tx) => {
      const exists = await tx.procedure.findUnique({ where: { id }, select: { id: true } });
      if (!exists) throw new NotFoundError("Procedimento");
      const procedure = await tx.procedure.update({ where: { id }, data: toData(input) });
      await recordAudit(tx, {
        ...auditContext(actor),
        action: "procedure.update",
        entityType: "procedure",
        entityId: id,
      });
      return procedure;
    });
  } catch (error) {
    if (isUniqueViolation(error, "name")) throw duplicateName();
    throw error;
  }
}

/** Desativar preserva o histórico: o procedimento só deixa de aparecer em novos cadastros. */
export async function setProcedureActive(db: DbClient, actor: Actor, id: string, isActive: boolean) {
  assertPermission(actor, "procedures:manage");
  return db.$transaction(async (tx) => {
    const exists = await tx.procedure.findUnique({ where: { id }, select: { id: true } });
    if (!exists) throw new NotFoundError("Procedimento");
    const procedure = await tx.procedure.update({ where: { id }, data: { isActive } });
    await recordAudit(tx, {
      ...auditContext(actor),
      action: isActive ? "procedure.activate" : "procedure.deactivate",
      entityType: "procedure",
      entityId: id,
    });
    return procedure;
  });
}
