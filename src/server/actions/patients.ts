"use server";

import type { ActionResult } from "@/lib/action-result";
import { formatPhone } from "@/lib/phone";
import { formDataToObject, uuidSchema } from "@/lib/validation/common";
import { interactionInputSchema } from "@/lib/validation/leads";
import { patientDeactivateSchema, patientInputSchema, patientNoteSchema } from "@/lib/validation/patients";
import { getNoteEncryptionKey } from "@/server/crypto/note-key";
import { searchPatients } from "@/server/queries/patients";
import {
  addPatientInteraction,
  addPatientNote,
  createPatient,
  setPatientActive,
  updatePatient,
} from "@/server/services/patients";

import { serviceClock as clock } from "./clock";
import { runAction } from "./run-action";

export async function savePatientAction(
  patientId: string | null,
  formData: FormData,
): Promise<ActionResult<{ id: string }>> {
  return runAction(
    "patients:write",
    async ({ db, actor }) => {
      const input = patientInputSchema.parse(formDataToObject(formData));
      const patient = patientId
        ? await updatePatient(db, actor, uuidSchema.parse(patientId), input, clock())
        : await createPatient(db, actor, input, clock());
      return { id: patient.id };
    },
    { message: patientId ? "Cadastro atualizado." : "Paciente cadastrado." },
  );
}

export async function setPatientActiveAction(
  patientId: string,
  active: boolean,
  reason?: string,
): Promise<ActionResult<null>> {
  return runAction(
    "patients:archive",
    async ({ db, actor }) => {
      const parsedReason = active ? undefined : patientDeactivateSchema.parse({ reason }).reason;
      await setPatientActive(db, actor, uuidSchema.parse(patientId), active === true, parsedReason, clock());
      return null;
    },
    { message: active ? "Paciente reativado." : "Paciente inativado." },
  );
}

export async function addPatientInteractionAction(patientId: string, formData: FormData): Promise<ActionResult<null>> {
  return runAction(
    "patients:write",
    async ({ db, actor }) => {
      const input = interactionInputSchema.parse(formDataToObject(formData));
      await addPatientInteraction(db, actor, uuidSchema.parse(patientId), input, clock());
      return null;
    },
    { message: "Interação registrada." },
  );
}

export async function addPatientNoteAction(patientId: string, formData: FormData): Promise<ActionResult<null>> {
  return runAction(
    "patients:read",
    async ({ db, actor }) => {
      const input = patientNoteSchema.parse(formDataToObject(formData));
      await addPatientNote(db, actor, uuidSchema.parse(patientId), input, getNoteEncryptionKey());
      return null;
    },
    { message: "Observação registrada." },
  );
}

export interface PatientSearchResult {
  id: string;
  fullName: string;
  phoneLabel: string;
}

export async function searchPatientsAction(query: string): Promise<ActionResult<PatientSearchResult[]>> {
  return runAction(
    "patients:read",
    async () => {
      const rows = await searchPatients(String(query ?? "").slice(0, 80));
      return rows.map((row) => ({ id: row.id, fullName: row.fullName, phoneLabel: formatPhone(row.phone) }));
    },
    { refresh: false },
  );
}
