"use server";

import type { ActionResult } from "@/lib/action-result";
import { formDataToObject, uuidSchema } from "@/lib/validation/common";
import { procedureInputSchema } from "@/lib/validation/procedures";
import { createProcedure, setProcedureActive, updateProcedure } from "@/server/services/procedures";

import { runAction } from "./run-action";

export async function saveProcedureAction(
  procedureId: string | null,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  return runAction(
    "procedures:manage",
    async ({ db, actor }) => {
      const input = procedureInputSchema.parse(formDataToObject(formData));
      const procedure = procedureId
        ? await updateProcedure(db, actor, uuidSchema.parse(procedureId), input)
        : await createProcedure(db, actor, input);
      return { id: procedure.id };
    },
    { message: procedureId ? "Procedimento atualizado." : "Procedimento cadastrado." },
  );
}

export async function setProcedureActiveAction(
  procedureId: string,
  isActive: boolean,
): Promise<ActionResult<null>> {
  return runAction(
    "procedures:manage",
    async ({ db, actor }) => {
      await setProcedureActive(db, actor, uuidSchema.parse(procedureId), isActive === true);
      return null;
    },
    { message: isActive ? "Procedimento reativado." : "Procedimento desativado." },
  );
}
