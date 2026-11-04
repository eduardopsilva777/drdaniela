"use server";

import type { ActionResult } from "@/lib/action-result";
import {
  applyProtocolSchema,
  cancelProtocolSchema,
  procedureRecordSchema,
  protocolInputSchema,
  returnCreateSchema,
  returnResolveSchema,
  returnUpdateSchema,
} from "@/lib/validation/care";
import { formDataToObject, uuidSchema } from "@/lib/validation/common";
import { DomainError } from "@/server/errors";
import {
  applyProtocolToPatient,
  cancelPatientProtocol,
  createProcedureRecord,
  createProtocol,
  createReturn,
  resolveReturn,
  setProtocolActive,
  updateProtocol,
  updateReturn,
} from "@/server/services/care-plan";

import { serviceClock } from "./clock";
import { runAction } from "./run-action";

/** Etapas e regras de acompanhamento chegam como JSON em campos ocultos do formulário. */
function parseProtocolForm(formData: FormData) {
  let steps: unknown;
  let followUpRules: unknown;
  try {
    steps = JSON.parse(String(formData.get("steps") ?? "[]"));
    followUpRules = JSON.parse(String(formData.get("followUpRules") ?? "[]"));
  } catch {
    throw new DomainError("Etapas do protocolo em formato inválido.");
  }
  return protocolInputSchema.parse({ ...formDataToObject(formData), steps, followUpRules });
}

export async function saveProtocolAction(protocolId: string | null, formData: FormData): Promise<ActionResult<{ id: string }>> {
  return runAction(
    "procedures:manage",
    async ({ db, actor }) => {
      const input = parseProtocolForm(formData);
      const protocol = protocolId
        ? await updateProtocol(db, actor, uuidSchema.parse(protocolId), input)
        : await createProtocol(db, actor, input);
      return { id: protocol.id };
    },
    { message: protocolId ? "Protocolo atualizado. As mudanças valem para novas aplicações." : "Protocolo cadastrado." },
  );
}

export async function setProtocolActiveAction(protocolId: string, isActive: boolean): Promise<ActionResult<null>> {
  return runAction(
    "procedures:manage",
    async ({ db, actor }) => {
      await setProtocolActive(db, actor, uuidSchema.parse(protocolId), isActive === true);
      return null;
    },
    { message: isActive ? "Protocolo reativado." : "Protocolo desativado." },
  );
}

export async function applyProtocolAction(patientId: string, formData: FormData): Promise<ActionResult<{ id: string }>> {
  return runAction(
    "protocols:assign",
    async ({ db, actor }) => {
      const input = applyProtocolSchema.parse(formDataToObject(formData));
      return applyProtocolToPatient(db, actor, uuidSchema.parse(patientId), input, serviceClock());
    },
    { message: "Protocolo aplicado e retornos programados." },
  );
}

export async function cancelPatientProtocolAction(patientProtocolId: string, reason: string): Promise<ActionResult<null>> {
  return runAction(
    "protocols:assign",
    async ({ db, actor }) => {
      const parsed = cancelProtocolSchema.parse({ reason });
      await cancelPatientProtocol(db, actor, uuidSchema.parse(patientProtocolId), parsed.reason, serviceClock());
      return null;
    },
    { message: "Protocolo cancelado. Os retornos pendentes foram cancelados." },
  );
}

export async function createProcedureRecordAction(patientId: string, formData: FormData): Promise<ActionResult<{ id: string }>> {
  return runAction(
    "patients:write",
    async ({ db, actor }) => {
      const input = procedureRecordSchema.parse(formDataToObject(formData));
      return createProcedureRecord(db, actor, uuidSchema.parse(patientId), input, serviceClock());
    },
    { message: "Procedimento registrado." },
  );
}

export async function createReturnAction(patientId: string, formData: FormData): Promise<ActionResult<{ id: string }>> {
  return runAction(
    "returns:write",
    async ({ db, actor }) => {
      const input = returnCreateSchema.parse(formDataToObject(formData));
      return createReturn(db, actor, uuidSchema.parse(patientId), input, serviceClock());
    },
    { message: "Retorno programado." },
  );
}

export async function updateReturnAction(returnId: string, formData: FormData): Promise<ActionResult<null>> {
  return runAction(
    "returns:write",
    async ({ db, actor }) => {
      const input = returnUpdateSchema.parse(formDataToObject(formData));
      await updateReturn(db, actor, uuidSchema.parse(returnId), input, serviceClock());
      return null;
    },
    { message: "Retorno atualizado." },
  );
}

export async function resolveReturnAction(
  returnId: string,
  input: { status: "COMPLETED" | "MISSED" | "CANCELLED"; date?: string },
): Promise<ActionResult<null>> {
  const parsed = returnResolveSchema.safeParse(input);
  return runAction(
    "returns:write",
    async ({ db, actor }) => {
      const data = parsed.success ? parsed.data : returnResolveSchema.parse(input);
      await resolveReturn(db, actor, uuidSchema.parse(returnId), data, serviceClock());
      return null;
    },
    {
      message: parsed.success
        ? { COMPLETED: "Comparecimento registrado.", MISSED: "Ausência registrada.", CANCELLED: "Retorno cancelado." }[parsed.data.status]
        : undefined,
    },
  );
}
