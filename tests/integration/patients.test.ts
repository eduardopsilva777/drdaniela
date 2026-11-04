import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { patientInputSchema } from "@/lib/validation/patients";
import { AuthorizationError } from "@/server/auth/errors";
import { DomainError } from "@/server/errors";
import {
  addPatientNote,
  createPatient,
  exportPatientData,
  readPatientNotes,
  setPatientActive,
  updatePatient,
} from "@/server/services/patients";

import {
  CLOCK,
  createTeam,
  createTestDb,
  createTestPatient,
  resetDatabase,
  testEncryptionKey,
} from "./helpers";

const db = createTestDb();
const key = testEncryptionKey();

beforeEach(() => resetDatabase(db));
afterAll(() => db.$disconnect());

function patientInput(overrides: Record<string, unknown> = {}) {
  return patientInputSchema.parse({
    fullName: "Joana Demo",
    phone: "11 91234-5678",
    ...overrides,
  });
}

describe("cadastro de pacientes", () => {
  it("grava consentimentos com data e registra cada um na auditoria", async () => {
    const team = await createTeam(db);
    const patient = await createPatient(
      db,
      team.asReception,
      patientInput({ whatsappOptIn: "on", imageUseConsent: "on", birthDate: "1990-05-20" }),
      CLOCK,
    );

    expect(patient).toMatchObject({
      phone: "+5511912345678",
      whatsappOptIn: true,
      whatsappOptInAt: CLOCK.now,
      marketingOptIn: false,
      marketingOptInAt: null,
      imageUseConsent: true,
    });
    expect(patient.birthDate?.toISOString().slice(0, 10)).toBe("1990-05-20");

    const consents = await db.auditLog.findMany({ where: { action: "patient.consent.update" } });
    expect(consents.map((entry) => entry.metadata)).toEqual(
      expect.arrayContaining([
        { consent: "whatsapp", granted: true },
        { consent: "uso_de_imagem", granted: true },
      ]),
    );
  });

  it("avisa sobre telefone duplicado e aceita quando confirmado (telefone compartilhado)", async () => {
    const team = await createTeam(db);
    await createPatient(db, team.asReception, patientInput(), CLOCK);

    const error = await createPatient(db, team.asReception, patientInput({ fullName: "Filha Demo" }), CLOCK).catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe("duplicate_patient_phone");

    await createPatient(db, team.asReception, patientInput({ fullName: "Filha Demo", allowDuplicatePhone: "on" }), CLOCK);
    expect(await db.patient.count()).toBe(2);
  });

  it("revogar o WhatsApp cancela os lembretes pendentes", async () => {
    const team = await createTeam(db);
    const patient = await createPatient(db, team.asReception, patientInput({ whatsappOptIn: "on" }), CLOCK);
    await db.reminder.create({ data: { kind: "RETURN", patientId: patient.id, scheduledFor: new Date("2026-11-20T12:00:00Z") } });

    await updatePatient(db, team.asReception, patient.id, patientInput({ whatsappOptIn: "" }), CLOCK);

    const reminder = await db.reminder.findFirstOrThrow();
    expect(reminder.status).toBe("CANCELLED");
    const stored = await db.patient.findUniqueOrThrow({ where: { id: patient.id } });
    expect(stored).toMatchObject({ whatsappOptIn: false, whatsappOptInAt: CLOCK.now });
  });

  it("inativar exige permissão, preserva o cadastro e cancela lembretes", async () => {
    const team = await createTeam(db);
    const patient = await createTestPatient(db, { whatsappOptIn: true });
    await db.reminder.create({ data: { kind: "RETURN", patientId: patient.id, scheduledFor: new Date("2026-11-20T12:00:00Z") } });

    await expect(setPatientActive(db, team.asReception, patient.id, false, "Mudou", CLOCK)).rejects.toBeInstanceOf(
      AuthorizationError,
    );
    await setPatientActive(db, team.asProfessional, patient.id, false, "Mudou de cidade", CLOCK);

    const stored = await db.patient.findUniqueOrThrow({ where: { id: patient.id } });
    expect(stored).toMatchObject({ isActive: false, inactivationReason: "Mudou de cidade", inactivatedAt: CLOCK.now });
    expect((await db.reminder.findFirstOrThrow()).status).toBe("CANCELLED");

    await setPatientActive(db, team.asProfessional, patient.id, true, undefined, CLOCK);
    expect((await db.patient.findUniqueOrThrow({ where: { id: patient.id } })).isActive).toBe(true);
  });
});

describe("observações do paciente", () => {
  it("são cifradas no banco e legíveis apenas com a chave e o paciente corretos", async () => {
    const team = await createTeam(db);
    const patient = await createTestPatient(db);
    await addPatientNote(db, team.asProfessional, patient.id, { visibility: "CLINICAL", content: "Texto sensível" }, key);

    const raw = await db.patientNote.findFirstOrThrow();
    expect(raw.content.startsWith("v1:")).toBe(true);
    expect(raw.content).not.toContain("sensível");

    const { notes } = await readPatientNotes(db, team.asProfessional, patient.id, key);
    expect(notes[0]).toMatchObject({ content: "Texto sensível", readable: true, authorName: "Daniela Profissional" });

    // Texto cifrado copiado para outro paciente não é aceito (dado autenticado).
    const other = await createTestPatient(db);
    await db.patientNote.create({
      data: { patientId: other.id, authorId: team.professional.id, visibility: "CLINICAL", content: raw.content },
    });
    const copied = await readPatientNotes(db, team.asProfessional, other.id, key);
    expect(copied.notes[0]?.readable).toBe(false);

    // Chave diferente: a observação continua protegida.
    const wrongKey = await readPatientNotes(db, team.asProfessional, patient.id, testEncryptionKey());
    expect(wrongKey.notes[0]?.readable).toBe(false);
  });

  it("recepção não lê nem grava observações clínicas", async () => {
    const team = await createTeam(db);
    const patient = await createTestPatient(db);
    await addPatientNote(db, team.asProfessional, patient.id, { visibility: "CLINICAL", content: "Clínica" }, key);
    await addPatientNote(db, team.asReception, patient.id, { visibility: "ADMINISTRATIVE", content: "Prefere manhã" }, key);

    await expect(
      addPatientNote(db, team.asReception, patient.id, { visibility: "CLINICAL", content: "Tentativa" }, key),
    ).rejects.toBeInstanceOf(AuthorizationError);

    const reception = await readPatientNotes(db, team.asReception, patient.id, key);
    expect(reception.includeClinical).toBe(false);
    expect(reception.notes.map((note) => note.content)).toEqual(["Prefere manhã"]);
    expect(await db.auditLog.count({ where: { action: "patient.clinical_notes.view" } })).toBe(0);
  });

  it("cada leitura de observações clínicas fica na auditoria", async () => {
    const team = await createTeam(db);
    const patient = await createTestPatient(db);
    await addPatientNote(db, team.asProfessional, patient.id, { visibility: "CLINICAL", content: "Clínica" }, key);
    await readPatientNotes(db, team.asProfessional, patient.id, key);
    await readPatientNotes(db, team.asAdmin, patient.id, key);

    const views = await db.auditLog.findMany({ where: { action: "patient.clinical_notes.view" } });
    expect(views.map((view) => view.actorId).sort()).toEqual([team.admin.id, team.professional.id].sort());
  });
});

describe("exportação de dados (LGPD)", () => {
  it("é restrita à administração, inclui o histórico e fica auditada", async () => {
    const team = await createTeam(db);
    const patient = await createTestPatient(db, { fullName: "Joana Demo" });
    await addPatientNote(db, team.asProfessional, patient.id, { visibility: "CLINICAL", content: "Clínica" }, key);
    await db.interaction.create({ data: { patientId: patient.id, type: "NOTE", content: "Nota comercial" } });

    await expect(exportPatientData(db, team.asProfessional, patient.id, key)).rejects.toBeInstanceOf(AuthorizationError);

    const data = await exportPatientData(db, team.asAdmin, patient.id, key);
    expect(data.patient.fullName).toBe("Joana Demo");
    expect(data.patient.notes).toEqual([expect.objectContaining({ content: "Clínica", visibility: "CLINICAL" })]);
    expect(data.patient.interactions).toHaveLength(1);
    expect(await db.auditLog.count({ where: { action: "patient.export", entityId: patient.id } })).toBe(1);
  });
});
