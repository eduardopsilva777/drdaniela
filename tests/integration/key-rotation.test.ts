import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { decryptField, encryptField, noteContext } from "@/server/crypto/field-encryption";
import { rotateNoteEncryption } from "@/server/maintenance/rotate-note-key";
import { addPatientNote, readPatientNotes } from "@/server/services/patients";

import { createTeam, createTestDb, createTestPatient, resetDatabase, testEncryptionKey } from "./helpers";

const db = createTestDb();

beforeEach(() => resetDatabase(db));
afterAll(() => db.$disconnect());

describe("rotação da chave das observações", () => {
  it("durante a rotação, notas antigas continuam legíveis com a chave anterior", async () => {
    const team = await createTeam(db);
    const patient = await createTestPatient(db);
    const oldKey = testEncryptionKey();
    const newKey = testEncryptionKey();
    await addPatientNote(db, team.asProfessional, patient.id, { visibility: "CLINICAL", content: "Gravada com a chave antiga" }, oldKey);

    const onlyNew = await readPatientNotes(db, team.asProfessional, patient.id, newKey);
    expect(onlyNew.notes[0]?.readable).toBe(false);

    const duringRotation = await readPatientNotes(db, team.asProfessional, patient.id, { current: newKey, previous: [oldKey] });
    expect(duringRotation.notes[0]).toMatchObject({ readable: true, content: "Gravada com a chave antiga" });
  });

  it("simula por padrão; ao aplicar, recifra com a chave nova e audita", async () => {
    const team = await createTeam(db);
    const patient = await createTestPatient(db);
    const oldKey = testEncryptionKey();
    const newKey = testEncryptionKey();
    const strangerKey = testEncryptionKey();

    await addPatientNote(db, team.asProfessional, patient.id, { visibility: "CLINICAL", content: "Antiga 1" }, oldKey);
    await addPatientNote(db, team.asProfessional, patient.id, { visibility: "ADMINISTRATIVE", content: "Antiga 2" }, oldKey);
    await addPatientNote(db, team.asProfessional, patient.id, { visibility: "CLINICAL", content: "Já nova" }, newKey);
    // Nota cifrada com uma chave desconhecida: não pode ser perdida nem "consertada".
    const orphan = await db.patientNote.create({
      data: {
        patientId: patient.id,
        authorId: team.professional.id,
        visibility: "CLINICAL",
        content: encryptField("Chave perdida", strangerKey, noteContext(patient.id)),
      },
    });

    const keyring = { current: newKey, previous: [oldKey] };
    const dryRun = await rotateNoteEncryption(db, { keyring, apply: false, batchSize: 2 });
    expect(dryRun).toEqual({ apply: false, total: 4, current: 1, reencrypted: 2, unreadable: 1 });
    expect(await db.auditLog.count({ where: { action: "data.encryption.rotate" } })).toBe(0);

    const applied = await rotateNoteEncryption(db, { keyring, apply: true, batchSize: 2 });
    expect(applied).toMatchObject({ apply: true, reencrypted: 2, unreadable: 1 });

    // Depois da rotação, a chave nova sozinha lê tudo o que era legível.
    const notes = await db.patientNote.findMany({ where: { id: { not: orphan.id } } });
    for (const note of notes) {
      expect(() => decryptField(note.content, newKey, noteContext(patient.id))).not.toThrow();
    }
    // A nota órfã foi preservada intacta.
    expect((await db.patientNote.findUniqueOrThrow({ where: { id: orphan.id } })).content).toBe(orphan.content);

    const again = await rotateNoteEncryption(db, { keyring, apply: false });
    expect(again).toMatchObject({ current: 3, reencrypted: 0, unreadable: 1 });
    expect(await db.auditLog.count({ where: { action: "data.encryption.rotate" } })).toBe(1);
  });
});
