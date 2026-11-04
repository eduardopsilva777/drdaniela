import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { isSealed, KNOWLEDGE_GAP_CONTEXT, memoryContext, messageContext, openText, sealText } from "@/server/crypto/content-cipher";
import { decryptField, encryptField, noteContext, type Keyring } from "@/server/crypto/field-encryption";
import { rotateDataEncryption } from "@/server/maintenance/rotate-encryption-key";
import { readGapQuestion, recordKnowledgeGap } from "@/server/services/knowledge";
import { addPatientNote, readPatientNotes } from "@/server/services/patients";

import { createTeam, createTestDb, createTestPatient, resetDatabase, testEncryptionKey, uniquePhone } from "./helpers";

const db = createTestDb();

beforeEach(() => resetDatabase(db));
afterAll(() => db.$disconnect());

const none = { total: 0, current: 0, reencrypted: 0, unreadable: 0 };
const onlyKey = (key: Buffer): Keyring => ({ current: key, previous: [] });

describe("rotação da DATA_ENCRYPTION_KEY", () => {
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

  it("simula por padrão; ao aplicar, recifra as observações com a chave nova e audita", async () => {
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
    const notesCounts = { total: 4, current: 1, reencrypted: 2, unreadable: 1 };
    const dryRun = await rotateDataEncryption(db, { keyring, apply: false, batchSize: 2 });
    expect(dryRun).toEqual({
      apply: false,
      ...notesCounts,
      byKind: { notes: notesCounts, messages: none, assistantMemories: none, knowledgeGaps: none },
    });
    expect(await db.auditLog.count({ where: { action: "data.encryption.rotate" } })).toBe(0);

    const applied = await rotateDataEncryption(db, { keyring, apply: true, batchSize: 2 });
    expect(applied).toMatchObject({ apply: true, reencrypted: 2, unreadable: 1 });

    // Depois da rotação, a chave nova sozinha lê tudo o que era legível.
    const notes = await db.patientNote.findMany({ where: { id: { not: orphan.id } } });
    for (const note of notes) {
      expect(() => decryptField(note.content, newKey, noteContext(patient.id))).not.toThrow();
    }
    // A nota órfã foi preservada intacta.
    expect((await db.patientNote.findUniqueOrThrow({ where: { id: orphan.id } })).content).toBe(orphan.content);

    const again = await rotateDataEncryption(db, { keyring, apply: false });
    expect(again).toMatchObject({ current: 3, reencrypted: 0, unreadable: 1 });
    expect(await db.auditLog.count({ where: { action: "data.encryption.rotate" } })).toBe(1);
  });

  it("recifra também as mensagens do WhatsApp, as notas do assistente e as perguntas de curadoria, que usam a mesma chave", async () => {
    const oldKey = testEncryptionKey();
    const newKey = testEncryptionKey();
    const strangerKey = testEncryptionKey();
    const conversation = await db.whatsAppConversation.create({ data: { contactPhone: uniquePhone(), mode: "HUMAN" } });
    const context = messageContext(conversation.id);
    const message = (body: string | null) =>
      db.whatsAppMessage.create({
        data: { conversationId: conversation.id, direction: "INBOUND", origin: "CONTACT", body, provider: "cloud_api", status: "RECEIVED" },
      });

    const old = await message(sealText("Mensagem antiga", context, onlyKey(oldKey)));
    // Texto do contato que só parece cifrado: lido do banco (prefixo "v1:") e ignorado.
    const lookalike = await message("v1: isso é texto digitado pelo contato");
    const alreadyNew = await message(sealText("Mensagem nova", context, onlyKey(newKey)));
    // Gravada antes de a chave existir (texto puro) e mensagem apagada: não são tocadas.
    const plain = await message("Texto sem cifragem");
    const erased = await message(null);
    // Chave desconhecida: preservada intacta e contada como ilegível.
    const orphan = await message(sealText("Chave perdida", context, onlyKey(strangerKey)));
    await recordKnowledgeGap(db, onlyKey(oldKey), { question: "Vocês atendem aos sábados?", reason: "NO_ANSWER", conversationId: conversation.id });
    // Notas da IA generativa sobre a conversa (contexto próprio) e uma conversa com notas em texto puro.
    await db.whatsAppConversation.update({
      where: { id: conversation.id },
      data: { assistantMemory: sealText("Interesse: botox; prefere tardes", memoryContext(conversation.id), onlyKey(oldKey)) },
    });
    await db.whatsAppConversation.create({ data: { contactPhone: uniquePhone(), assistantMemory: "Notas sem cifragem" } });
    // Lotes de 1: o cursor precisa avançar mesmo pelas linhas ignoradas.
    const keyring = { current: newKey, previous: [oldKey] };

    const dryRun = await rotateDataEncryption(db, { keyring, apply: false, batchSize: 1 });
    expect(dryRun.byKind).toEqual({
      notes: none,
      messages: { total: 3, current: 1, reencrypted: 1, unreadable: 1 },
      assistantMemories: { total: 1, current: 0, reencrypted: 1, unreadable: 0 },
      knowledgeGaps: { total: 1, current: 0, reencrypted: 1, unreadable: 0 },
    });
    expect((await db.whatsAppMessage.findUniqueOrThrow({ where: { id: old.id } })).body).toBe(old.body);

    const applied = await rotateDataEncryption(db, { keyring, apply: true, batchSize: 1 });
    expect(applied).toMatchObject({ total: 5, reencrypted: 3, unreadable: 1 });

    // Só a chave nova: tudo o que era legível continua legível.
    const newOnly = onlyKey(newKey);
    const read = async (id: string) => openText((await db.whatsAppMessage.findUniqueOrThrow({ where: { id } })).body, context, newOnly);
    expect(await read(old.id)).toBe("Mensagem antiga");
    expect(await read(alreadyNew.id)).toBe("Mensagem nova");
    expect((await db.whatsAppMessage.findUniqueOrThrow({ where: { id: plain.id } })).body).toBe("Texto sem cifragem");
    expect((await db.whatsAppMessage.findUniqueOrThrow({ where: { id: lookalike.id } })).body).toBe(lookalike.body);
    expect((await db.whatsAppMessage.findUniqueOrThrow({ where: { id: erased.id } })).body).toBeNull();
    expect((await db.whatsAppMessage.findUniqueOrThrow({ where: { id: orphan.id } })).body).toBe(orphan.body);

    const gap = await db.knowledgeGap.findFirstOrThrow();
    expect(isSealed(gap.question)).toBe(true);
    expect(readGapQuestion(gap.question, newOnly)).toBe("Vocês atendem aos sábados?");
    expect(() => decryptField(gap.question, newKey, KNOWLEDGE_GAP_CONTEXT)).not.toThrow();

    const memory = (await db.whatsAppConversation.findUniqueOrThrow({ where: { id: conversation.id } })).assistantMemory;
    expect(openText(memory, memoryContext(conversation.id), newOnly)).toBe("Interesse: botox; prefere tardes");
    expect(await db.whatsAppConversation.count({ where: { assistantMemory: "Notas sem cifragem" } })).toBe(1);

    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "data.encryption.rotate" } });
    expect(audit.metadata).toMatchObject({
      reencrypted: 3,
      unreadable: 1,
      patientRecords: 0,
      whatsappMessages: 1,
      assistantMemories: 1,
      curationQuestions: 1,
    });
  });
});
