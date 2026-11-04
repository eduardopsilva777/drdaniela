import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { hasPermission } from "@/lib/auth/permissions";
import { dateKeyToDbDate } from "@/lib/datetime";
import type { InteractionInput } from "@/lib/validation/leads";
import type { PatientInput, PatientNoteInput } from "@/lib/validation/patients";
import { recordAudit } from "@/server/audit";
import { memoryContext, openMessageBodies, openText } from "@/server/crypto/content-cipher";
import { decryptWithKeyring, encryptField, noteContext, toKeyring, type Keyring } from "@/server/crypto/field-encryption";
import type { DbClient, DbExecutor } from "@/server/db/prisma";
import { DomainError, NotFoundError } from "@/server/errors";

import { recordStaffConsentChange } from "./consent";
import { assertPermission, auditContext, type Actor } from "./context";
import { resolveOccurredAt, type ServiceClock } from "./leads";

/** Consentimentos de mensagens com histórico próprio (consent_events). */
const MESSAGING_CONSENTS = { whatsapp: "WHATSAPP", marketing: "MARKETING" } as const;

/**
 * Pacientes: cadastro mínimo (LGPD), consentimentos com data e histórico na
 * auditoria, observações sempre cifradas e leitura de observações clínicas
 * restrita e registrada.
 */

const CONSENTS = [
  { field: "whatsappOptIn", at: "whatsappOptInAt", key: "whatsapp" },
  { field: "marketingOptIn", at: "marketingOptInAt", key: "marketing" },
  { field: "imageUseConsent", at: "imageUseConsentAt", key: "uso_de_imagem" },
] as const;

async function assertPhoneForPatient(db: DbExecutor, phone: string, allowDuplicate: boolean, excludeId?: string) {
  if (allowDuplicate) return;
  const other = await db.patient.findFirst({
    where: { phone, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { id: true, fullName: true },
  });
  if (other) {
    const message = `Já existe paciente com este telefone: ${other.fullName}. Se for outra pessoa (ex.: telefone do responsável), confirme abaixo.`;
    throw new DomainError(message, {
      code: "duplicate_patient_phone",
      fieldErrors: { phone: [message] },
      meta: { existingPatientId: other.id },
    });
  }
}

export async function createPatient(db: DbClient, actor: Actor, input: PatientInput, clock: ServiceClock) {
  assertPermission(actor, "patients:write");
  await assertPhoneForPatient(db, input.phone, input.allowDuplicatePhone);
  const now = clock.now ?? new Date();

  return db.$transaction(async (tx) => {
    const patient = await tx.patient.create({
      data: {
        fullName: input.fullName,
        preferredName: input.preferredName ?? null,
        phone: input.phone,
        email: input.email ?? null,
        birthDate: input.birthDate ? dateKeyToDbDate(input.birthDate) : null,
        source: input.source ?? null,
        sourceDetail: input.sourceDetail ?? null,
        whatsappOptIn: input.whatsappOptIn,
        whatsappOptInAt: input.whatsappOptIn ? now : null,
        marketingOptIn: input.marketingOptIn,
        marketingOptInAt: input.marketingOptIn ? now : null,
        imageUseConsent: input.imageUseConsent,
        imageUseConsentAt: input.imageUseConsent ? now : null,
      },
    });
    await tx.interaction.create({
      data: { patientId: patient.id, type: "SYSTEM", content: "Paciente cadastrado.", authorId: actor.id, occurredAt: now },
    });
    await recordAudit(tx, { ...auditContext(actor), action: "patient.create", entityType: "patient", entityId: patient.id });
    for (const consent of CONSENTS) {
      if (input[consent.field]) {
        await recordAudit(tx, {
          ...auditContext(actor),
          action: "patient.consent.update",
          entityType: "patient",
          entityId: patient.id,
          metadata: { consent: consent.key, granted: true },
        });
        if (consent.key === "whatsapp" || consent.key === "marketing") {
          await recordStaffConsentChange(tx, {
            phone: patient.phone,
            purpose: MESSAGING_CONSENTS[consent.key],
            granted: true,
            actorId: actor.id,
            patientId: patient.id,
          });
        }
      }
    }
    return patient;
  });
}

export async function updatePatient(
  db: DbClient,
  actor: Actor,
  patientId: string,
  input: PatientInput,
  clock: ServiceClock,
) {
  assertPermission(actor, "patients:write");
  const now = clock.now ?? new Date();
  const current = await db.patient.findUnique({ where: { id: patientId } });
  if (!current) throw new NotFoundError("Paciente");
  if (current.phone !== input.phone) await assertPhoneForPatient(db, input.phone, input.allowDuplicatePhone, patientId);

  const data: Prisma.PatientUncheckedUpdateInput = {
    fullName: input.fullName,
    preferredName: input.preferredName ?? null,
    phone: input.phone,
    email: input.email ?? null,
    birthDate: input.birthDate ? dateKeyToDbDate(input.birthDate) : null,
    source: input.source ?? null,
    sourceDetail: input.sourceDetail ?? null,
  };
  const consentChanges = CONSENTS.filter((consent) => current[consent.field] !== input[consent.field]);
  for (const consent of consentChanges) {
    data[consent.field] = input[consent.field];
    data[consent.at] = now;
  }

  return db.$transaction(async (tx) => {
    const patient = await tx.patient.update({ where: { id: patientId }, data });
    await recordAudit(tx, { ...auditContext(actor), action: "patient.update", entityType: "patient", entityId: patientId });
    for (const consent of consentChanges) {
      await recordAudit(tx, {
        ...auditContext(actor),
        action: "patient.consent.update",
        entityType: "patient",
        entityId: patientId,
        metadata: { consent: consent.key, granted: input[consent.field] },
      });
      if (consent.key === "whatsapp" || consent.key === "marketing") {
        await recordStaffConsentChange(tx, {
          phone: patient.phone,
          purpose: MESSAGING_CONSENTS[consent.key],
          granted: input[consent.field],
          actorId: actor.id,
          patientId,
        });
      }
    }
    // Sem consentimento para WhatsApp, lembretes pendentes ou pausados deixam de ser enviados.
    if (consentChanges.some((consent) => consent.key === "whatsapp") && !input.whatsappOptIn) {
      await tx.reminder.updateMany({
        where: { patientId, status: { in: ["PENDING", "PAUSED"] }, channel: "WHATSAPP" },
        data: { status: "CANCELLED", cancelledAt: now, lastError: "Consentimento para WhatsApp revogado." },
      });
    }
    return patient;
  });
}

export async function setPatientActive(
  db: DbClient,
  actor: Actor,
  patientId: string,
  active: boolean,
  reason: string | undefined,
  clock: ServiceClock,
) {
  assertPermission(actor, "patients:archive");
  const now = clock.now ?? new Date();
  return db.$transaction(async (tx) => {
    const patient = await tx.patient.findUnique({ where: { id: patientId }, select: { id: true, isActive: true } });
    if (!patient) throw new NotFoundError("Paciente");
    if (patient.isActive === active) return patient;

    await tx.patient.update({
      where: { id: patientId },
      data: active
        ? { isActive: true, inactivatedAt: null, inactivationReason: null }
        : { isActive: false, inactivatedAt: now, inactivationReason: reason ?? null },
    });
    if (!active) {
      await tx.reminder.updateMany({
        where: { patientId, status: "PENDING" },
        data: { status: "CANCELLED", cancelledAt: now, lastError: "Paciente inativado." },
      });
    }
    await recordAudit(tx, {
      ...auditContext(actor),
      action: active ? "patient.activate" : "patient.deactivate",
      entityType: "patient",
      entityId: patientId,
    });
    return { ...patient, isActive: active };
  });
}

export async function addPatientInteraction(
  db: DbClient,
  actor: Actor,
  patientId: string,
  input: InteractionInput,
  clock: ServiceClock,
) {
  assertPermission(actor, "patients:write");
  const occurredAt = resolveOccurredAt(input, clock);
  return db.$transaction(async (tx) => {
    const patient = await tx.patient.findUnique({ where: { id: patientId }, select: { id: true } });
    if (!patient) throw new NotFoundError("Paciente");
    const interaction = await tx.interaction.create({
      data: {
        patientId,
        type: input.type,
        direction: input.type === "NOTE" ? null : (input.direction ?? null),
        content: input.content,
        occurredAt,
        authorId: actor.id,
      },
    });
    await recordAudit(tx, {
      ...auditContext(actor),
      action: "patient.interaction.create",
      entityType: "patient",
      entityId: patientId,
      metadata: { type: input.type },
    });
    return interaction;
  });
}

export async function addPatientNote(
  db: DbClient,
  actor: Actor,
  patientId: string,
  input: PatientNoteInput,
  key: Buffer,
) {
  assertPermission(actor, input.visibility === "CLINICAL" ? "clinical-notes:write" : "patients:write");
  return db.$transaction(async (tx) => {
    const patient = await tx.patient.findUnique({ where: { id: patientId }, select: { id: true } });
    if (!patient) throw new NotFoundError("Paciente");
    const note = await tx.patientNote.create({
      data: {
        patientId,
        authorId: actor.id,
        visibility: input.visibility,
        content: encryptField(input.content, key, noteContext(patientId)),
      },
    });
    await recordAudit(tx, {
      ...auditContext(actor),
      action: "patient.note.create",
      entityType: "patient",
      entityId: patientId,
      metadata: { visibility: input.visibility },
    });
    return { id: note.id };
  });
}

export interface PatientNoteView {
  id: string;
  visibility: "CLINICAL" | "ADMINISTRATIVE";
  content: string;
  readable: boolean;
  authorName: string;
  createdAt: Date;
}

/**
 * Lê as observações do paciente. As clínicas só são incluídas para quem tem
 * permissão, e cada leitura delas fica registrada na auditoria.
 */
export async function readPatientNotes(db: DbClient, actor: Actor, patientId: string, keys: Buffer | Keyring) {
  assertPermission(actor, "patients:read");
  const includeClinical = hasPermission(actor.role, "clinical-notes:read");
  const notes = await db.patientNote.findMany({
    where: { patientId, ...(includeClinical ? {} : { visibility: "ADMINISTRATIVE" }) },
    orderBy: { createdAt: "desc" },
    include: { author: { select: { name: true } } },
  });

  if (includeClinical && notes.some((note) => note.visibility === "CLINICAL")) {
    await recordAudit(db, {
      ...auditContext(actor),
      action: "patient.clinical_notes.view",
      entityType: "patient",
      entityId: patientId,
    });
  }

  return {
    includeClinical,
    notes: notes.map((note): PatientNoteView => {
      let content = "";
      let readable = true;
      try {
        content = decryptWithKeyring(note.content, keys, noteContext(patientId)).plaintext;
      } catch {
        readable = false;
        content = "Não foi possível ler esta observação: a chave de cifragem atual é diferente da usada na gravação.";
      }
      return {
        id: note.id,
        visibility: note.visibility,
        content,
        readable,
        authorName: note.author.name,
        createdAt: note.createdAt,
      };
    }),
  };
}

/**
 * Exportação dos dados do paciente (direito de acesso — LGPD art. 18).
 * Inclui todo o histórico vinculado, com observações e mensagens decifradas;
 * a operação é auditada. Sem chave configurada (`keys` nulo), a exportação
 * continua possível e os conteúdos cifrados aparecem como ilegíveis.
 */
export async function exportPatientData(db: DbClient, actor: Actor, patientId: string, keys: Buffer | Keyring | null) {
  assertPermission(actor, "patients:export");
  const patient = await db.patient.findUnique({
    where: { id: patientId },
    include: {
      lead: { select: { name: true, phone: true, email: true, source: true, sourceDetail: true, interest: true, status: true, createdAt: true, convertedAt: true } },
      interactions: { orderBy: { occurredAt: "asc" }, select: { type: true, direction: true, content: true, occurredAt: true, fromStatus: true, toStatus: true } },
      appointments: { orderBy: { startsAt: "asc" }, select: { startsAt: true, endsAt: true, status: true, notes: true, cancellationReason: true, procedure: { select: { name: true } } } },
      procedureRecords: { orderBy: { performedAt: "asc" }, select: { performedAt: true, notes: true, procedure: { select: { name: true } } } },
      protocols: { select: { startedOn: true, status: true, notes: true, protocol: { select: { name: true } } } },
      returns: { orderBy: { dueDate: "asc" }, select: { title: true, dueDate: true, status: true, notes: true } },
      conversations: {
        select: {
          id: true,
          contactPhone: true,
          assistantMemory: true,
          messages: { orderBy: { createdAt: "asc" }, select: { direction: true, body: true, status: true, createdAt: true } },
        },
      },
      notes: { orderBy: { createdAt: "asc" }, select: { visibility: true, content: true, createdAt: true } },
    },
  });
  if (!patient) throw new NotFoundError("Paciente");

  await recordAudit(db, { ...auditContext(actor), action: "patient.export", entityType: "patient", entityId: patientId });

  const keyring = keys ? toKeyring(keys) : null;
  const { notes, conversations, ...rest } = patient;
  return {
    exportedAt: new Date().toISOString(),
    exportedBy: actor.name,
    patient: {
      ...rest,
      // O texto das mensagens é gravado cifrado (contexto: a conversa).
      conversations: conversations.map(({ id, messages, assistantMemory, ...conversation }) => ({
        ...conversation,
        // Notas que o assistente mantém sobre a conversa (dado pessoal derivado).
        assistantNotes: openText(assistantMemory, memoryContext(id), keyring),
        messages: openMessageBodies(id, messages, keyring),
      })),
      notes: notes.map((note) => {
        let content: string;
        if (!keyring) {
          content = "[ilegível: chave de cifragem não configurada]";
        } else {
          try {
            content = decryptWithKeyring(note.content, keyring, noteContext(patientId)).plaintext;
          } catch {
            content = "[ilegível com a chave atual]";
          }
        }
        return { visibility: note.visibility, createdAt: note.createdAt, content };
      }),
    },
  };
}
