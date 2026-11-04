"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import type { ActionResult } from "@/lib/action-result";
import { formDataToObject, uuidSchema } from "@/lib/validation/common";
import { passwordChangeSchema, staffInputSchema, staffUpdateSchema } from "@/lib/validation/users";
import { getCurrentSession } from "@/server/auth/dal";
import { getLoginThrottlePolicy } from "@/server/auth/policy";
import { getDb } from "@/server/db";
import { getRequestMeta } from "@/server/request-meta";
import {
  changeOwnPassword,
  createStaffAccount,
  resetStaffPassword,
  setStaffActive,
  updateStaffAccount,
} from "@/server/services/users";

import { runAction, toFailure } from "./run-action";

export async function createStaffAction(formData: FormData): Promise<ActionResult<{ id: string; temporaryPassword: string }>> {
  return runAction(
    "users:manage",
    async ({ db, actor }) => createStaffAccount(db, actor, staffInputSchema.parse(formDataToObject(formData))),
    { message: "Conta criada." },
  );
}

export async function updateStaffAction(userId: string, formData: FormData): Promise<ActionResult<null>> {
  return runAction(
    "users:manage",
    async ({ db, actor }) => {
      await updateStaffAccount(db, actor, uuidSchema.parse(userId), staffUpdateSchema.parse(formDataToObject(formData)));
      return null;
    },
    { message: "Conta atualizada." },
  );
}

export async function setStaffActiveAction(userId: string, active: boolean): Promise<ActionResult<null>> {
  return runAction(
    "users:manage",
    async ({ db, actor }) => {
      await setStaffActive(db, actor, uuidSchema.parse(userId), z.boolean().parse(active));
      return null;
    },
    { message: active ? "Conta reativada." : "Conta desativada e sessões encerradas." },
  );
}

export async function resetStaffPasswordAction(userId: string): Promise<ActionResult<{ temporaryPassword: string }>> {
  return runAction(
    "users:manage",
    async ({ db, actor }) => resetStaffPassword(db, actor, uuidSchema.parse(userId)),
    { message: "Senha provisória gerada. As sessões da pessoa foram encerradas." },
  );
}

/**
 * Troca da própria senha. Não usa `runAction` porque precisa funcionar também
 * com a troca obrigatória pendente (quando todo o resto redireciona para cá).
 */
export async function changeOwnPasswordAction(formData: FormData): Promise<ActionResult<null>> {
  const session = await getCurrentSession();
  if (!session) redirect("/login");
  const wasForced = session.user.mustChangePassword;

  try {
    const input = passwordChangeSchema.parse(formDataToObject(formData));
    const meta = await getRequestMeta();
    await changeOwnPassword(
      getDb(),
      { id: session.user.id, name: session.user.name, role: session.user.role, ...meta },
      { currentPassword: input.currentPassword, newPassword: input.newPassword },
      session.sessionId,
      new Date(),
      getLoginThrottlePolicy(),
    );
  } catch (error) {
    return toFailure(error);
  }

  if (wasForced) redirect("/dashboard");
  return { ok: true, data: null, message: "Senha alterada. As outras sessões abertas foram encerradas." };
}
