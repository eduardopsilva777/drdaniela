"use server";

import type { ActionResult } from "@/lib/action-result";
import { formDataToObject, uuidSchema } from "@/lib/validation/common";
import {
  interactionInputSchema,
  leadConvertSchema,
  leadInputSchema,
  leadStatusChangeSchema,
} from "@/lib/validation/leads";
import {
  addLeadInteraction,
  changeLeadStatus,
  convertLeadToPatient,
  createLead,
  deleteLead,
  describeStageMove,
  findPatientMatchesForLead,
  updateLead,
} from "@/server/services/leads";

import { serviceClock as clock } from "./clock";
import { runAction } from "./run-action";

export async function saveLeadAction(leadId: string | null, formData: FormData): Promise<ActionResult<{ id: string }>> {
  return runAction(
    "leads:write",
    async ({ db, actor }) => {
      const input = leadInputSchema.parse(formDataToObject(formData));
      const lead = leadId
        ? await updateLead(db, actor, uuidSchema.parse(leadId), input, clock())
        : await createLead(db, actor, input, clock());
      return { id: lead.id };
    },
    { message: leadId ? "Lead atualizado." : "Lead cadastrado." },
  );
}

export async function changeLeadStatusAction(input: {
  leadId: string;
  status: string;
  lostReason?: string;
}): Promise<ActionResult<null>> {
  const parsed = leadStatusChangeSchema.safeParse(input);
  return runAction("leads:write", async ({ db, actor }) => {
    const change = parsed.success ? parsed.data : leadStatusChangeSchema.parse(input);
    await changeLeadStatus(db, actor, change, clock());
    return null;
  }, { message: parsed.success ? describeStageMove(parsed.data.status) : undefined });
}

export async function addLeadInteractionAction(leadId: string, formData: FormData): Promise<ActionResult<null>> {
  return runAction(
    "leads:write",
    async ({ db, actor }) => {
      const input = interactionInputSchema.parse(formDataToObject(formData));
      await addLeadInteraction(db, actor, uuidSchema.parse(leadId), input, clock());
      return null;
    },
    { message: "Interação registrada." },
  );
}

export async function getConversionMatchesAction(
  leadId: string,
): Promise<ActionResult<Array<{ id: string; fullName: string }>>> {
  return runAction(
    "patients:read",
    async ({ db }) => {
      const matches = await findPatientMatchesForLead(db, uuidSchema.parse(leadId));
      return matches.map(({ id, fullName }) => ({ id, fullName }));
    },
    { refresh: false },
  );
}

export async function convertLeadAction(
  leadId: string,
  formData: FormData,
): Promise<ActionResult<{ patientId: string }>> {
  return runAction(
    "leads:write",
    async ({ db, actor }) => {
      const input = leadConvertSchema.parse(formDataToObject(formData));
      return convertLeadToPatient(db, actor, uuidSchema.parse(leadId), input, clock());
    },
    { message: "Lead convertido em paciente." },
  );
}

export async function deleteLeadAction(leadId: string): Promise<ActionResult<null>> {
  return runAction(
    "leads:delete",
    async ({ db, actor }) => {
      await deleteLead(db, actor, uuidSchema.parse(leadId));
      return null;
    },
    { message: "Lead excluído.", refresh: false },
  );
}
