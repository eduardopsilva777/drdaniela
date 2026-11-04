import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import type { LeadStatus } from "@/generated/prisma/enums";
import { dateKeyToDbDate, timeOf, zonedDateTime } from "@/lib/datetime";
import { LEAD_STATUS_LABELS } from "@/lib/labels";
import type {
  InteractionInput,
  LeadConvertInput,
  LeadInput,
  LeadStatusChange,
} from "@/lib/validation/leads";
import { recordAudit } from "@/server/audit";
import type { DbClient, DbExecutor } from "@/server/db/prisma";
import { DomainError, isUniqueViolation, NotFoundError } from "@/server/errors";

import { recordStaffConsentChange } from "./consent";
import { assertPermission, auditContext, type Actor } from "./context";
import { DEFAULT_REMINDER_SETTINGS, scheduleAppointmentReminder, type ReminderSettings } from "./reminders";

/**
 * Regras do funil comercial:
 * - Um lead por telefone (E.164) — e um telefone que já é de paciente não vira lead novo.
 * - "Perdido" exige motivo; "Convertido" só pela conversão em paciente.
 * - Registrar o primeiro contato move o lead de "Novo" para "Em atendimento".
 * - `peakStatus` guarda a etapa mais avançada já alcançada (indicadores do funil).
 */

export interface ServiceClock {
  timeZone: string;
  now?: Date;
}

const FUNNEL_RANK: Record<LeadStatus, number> = {
  NEW: 0,
  IN_PROGRESS: 1,
  SCHEDULED: 2,
  CONVERTED: 3,
  LOST: -1,
};

/** A etapa mais avançada entre a atual e a de destino ("Perdido" não conta como avanço). */
export function higherStage(current: LeadStatus, target: LeadStatus): LeadStatus {
  return FUNNEL_RANK[target] > FUNNEL_RANK[current] ? target : current;
}

const CONTACT_TYPES = new Set(["CALL", "WHATSAPP", "EMAIL", "IN_PERSON"]);

function nextActionFrom(input: { nextActionDate?: string; nextActionTime?: string }, timeZone: string) {
  if (!input.nextActionDate) return null;
  return zonedDateTime(input.nextActionDate, input.nextActionTime ?? "09:00", timeZone);
}

function duplicateLeadError(lead: { id: string; name: string }): DomainError {
  const message = `Já existe um lead com este telefone: ${lead.name}.`;
  return new DomainError(message, {
    code: "duplicate_lead",
    fieldErrors: { phone: [message] },
    meta: { existingLeadId: lead.id },
  });
}

async function assertPhoneAvailable(db: DbExecutor, phone: string, excludeLeadId?: string) {
  const lead = await db.lead.findUnique({ where: { phone }, select: { id: true, name: true } });
  if (lead && lead.id !== excludeLeadId) throw duplicateLeadError(lead);

  const patient = await db.patient.findFirst({ where: { phone }, select: { id: true, fullName: true } });
  if (patient) {
    const message = `Este telefone já está no cadastro de paciente de ${patient.fullName}. Registre o novo interesse na ficha do paciente.`;
    throw new DomainError(message, {
      code: "phone_belongs_to_patient",
      fieldErrors: { phone: [message] },
      meta: { existingPatientId: patient.id },
    });
  }
}

async function assertReferences(db: DbExecutor, input: { procedureId?: string; ownerId?: string }) {
  if (input.procedureId) {
    const procedure = await db.procedure.findUnique({ where: { id: input.procedureId }, select: { id: true } });
    if (!procedure) throw new DomainError("Procedimento de interesse inválido.", { fieldErrors: { procedureId: ["Selecione um procedimento válido."] } });
  }
  if (input.ownerId) {
    const owner = await db.user.findFirst({ where: { id: input.ownerId, isActive: true }, select: { id: true } });
    if (!owner) throw new DomainError("Responsável inválido.", { fieldErrors: { ownerId: ["Selecione um membro ativo da equipe."] } });
  }
}

export async function createLead(db: DbClient, actor: Actor, input: LeadInput, clock: ServiceClock) {
  assertPermission(actor, "leads:write");
  const now = clock.now ?? new Date();
  await assertPhoneAvailable(db, input.phone);
  await assertReferences(db, input);

  try {
    return await db.$transaction(async (tx) => {
      const lead = await tx.lead.create({
        data: {
          name: input.name,
          phone: input.phone,
          email: input.email ?? null,
          source: input.source,
          sourceDetail: input.sourceDetail ?? null,
          interest: input.interest ?? null,
          procedureId: input.procedureId ?? null,
          priority: input.priority,
          ownerId: input.ownerId ?? null,
          notes: input.notes ?? null,
          nextActionAt: nextActionFrom(input, clock.timeZone),
          nextActionNote: input.nextActionNote ?? null,
          whatsappOptIn: input.whatsappOptIn,
          whatsappOptInAt: input.whatsappOptIn ? now : null,
          statusChangedAt: now,
          createdAt: now,
        },
      });
      await tx.interaction.create({
        data: {
          leadId: lead.id,
          type: "SYSTEM",
          content: "Lead cadastrado.",
          authorId: actor.id,
          occurredAt: now,
        },
      });
      await recordAudit(tx, {
        ...auditContext(actor),
        action: "lead.create",
        entityType: "lead",
        entityId: lead.id,
        metadata: { leadSource: input.source },
      });
      if (input.whatsappOptIn) {
        await recordStaffConsentChange(tx, { phone: lead.phone, purpose: "WHATSAPP", granted: true, actorId: actor.id, leadId: lead.id });
      }
      return lead;
    });
  } catch (error) {
    if (isUniqueViolation(error, "phone")) {
      const existing = await db.lead.findUnique({ where: { phone: input.phone }, select: { id: true, name: true } });
      if (existing) throw duplicateLeadError(existing);
    }
    throw error;
  }
}

export async function updateLead(db: DbClient, actor: Actor, leadId: string, input: LeadInput, clock: ServiceClock) {
  assertPermission(actor, "leads:write");
  const now = clock.now ?? new Date();
  const current = await db.lead.findUnique({ where: { id: leadId } });
  if (!current) throw new NotFoundError("Lead");
  if (current.phone !== input.phone) await assertPhoneAvailable(db, input.phone, leadId);
  await assertReferences(db, input);

  const data: Prisma.LeadUncheckedUpdateInput = {
    name: input.name,
    phone: input.phone,
    email: input.email ?? null,
    source: input.source,
    sourceDetail: input.sourceDetail ?? null,
    interest: input.interest ?? null,
    procedureId: input.procedureId ?? null,
    priority: input.priority,
    ownerId: input.ownerId ?? null,
    notes: input.notes ?? null,
    nextActionAt: nextActionFrom(input, clock.timeZone),
    nextActionNote: input.nextActionNote ?? null,
    whatsappOptIn: input.whatsappOptIn,
  };
  if (input.whatsappOptIn !== current.whatsappOptIn) data.whatsappOptInAt = input.whatsappOptIn ? now : null;

  const changed = (Object.keys(data) as Array<keyof typeof data>).filter((key) => {
    const before = current[key as keyof typeof current];
    const after = data[key];
    return (before instanceof Date ? before.getTime() : before) !== (after instanceof Date ? after.getTime() : after);
  });

  try {
    return await db.$transaction(async (tx) => {
      const lead = await tx.lead.update({ where: { id: leadId }, data });
      await recordAudit(tx, {
        ...auditContext(actor),
        action: "lead.update",
        entityType: "lead",
        entityId: leadId,
        metadata: { fields: changed.join(",") },
      });
      if (input.whatsappOptIn !== current.whatsappOptIn) {
        await recordStaffConsentChange(tx, {
          phone: lead.phone,
          purpose: "WHATSAPP",
          granted: input.whatsappOptIn,
          actorId: actor.id,
          leadId,
        });
      }
      return lead;
    });
  } catch (error) {
    if (isUniqueViolation(error, "phone")) {
      const existing = await db.lead.findUnique({ where: { phone: input.phone }, select: { id: true, name: true } });
      if (existing) throw duplicateLeadError(existing);
    }
    throw error;
  }
}

export async function changeLeadStatus(db: DbClient, actor: Actor, change: LeadStatusChange, clock: ServiceClock) {
  assertPermission(actor, "leads:write");
  const now = clock.now ?? new Date();

  if (change.status === "CONVERTED") {
    throw new DomainError("Para converter, use “Converter em paciente” — assim o cadastro do paciente é criado junto.", {
      code: "use_conversion",
    });
  }

  return db.$transaction(async (tx) => {
    const lead = await tx.lead.findUnique({
      where: { id: change.leadId },
      select: { id: true, status: true, peakStatus: true },
    });
    if (!lead) throw new NotFoundError("Lead");
    if (lead.status === "CONVERTED") {
      throw new DomainError("Este lead já é paciente e não volta para o funil.", { code: "already_converted" });
    }
    if (lead.status === change.status) return lead;

    const isLost = change.status === "LOST";
    // Atualização condicional: se outra pessoa mudou a etapa no meio do caminho, nada é sobrescrito.
    const updated = await tx.lead.updateMany({
      where: { id: lead.id, status: lead.status },
      data: {
        status: change.status,
        peakStatus: higherStage(lead.peakStatus, change.status),
        statusChangedAt: now,
        lostReason: isLost ? (change.lostReason ?? null) : null,
        lostAt: isLost ? now : null,
      },
    });
    if (updated.count === 0) {
      throw new DomainError("Este lead acabou de ser alterado por outra pessoa. Atualize a página e tente de novo.", {
        code: "concurrent_update",
      });
    }

    await tx.interaction.create({
      data: {
        leadId: lead.id,
        type: "STATUS_CHANGE",
        fromStatus: lead.status,
        toStatus: change.status,
        content: isLost ? `Motivo da perda: ${change.lostReason}` : null,
        authorId: actor.id,
        occurredAt: now,
      },
    });
    await recordAudit(tx, {
      ...auditContext(actor),
      action: "lead.status.change",
      entityType: "lead",
      entityId: lead.id,
      metadata: { from: lead.status, to: change.status },
    });
    return { ...lead, status: change.status };
  });
}

/** Valida a data informada para uma interação (padrão: agora; nunca no futuro). */
export function resolveOccurredAt(input: InteractionInput, clock: ServiceClock): Date {
  const now = clock.now ?? new Date();
  if (!input.occurredDate) return now;
  const occurredAt = zonedDateTime(input.occurredDate, input.occurredTime ?? timeOf(now, clock.timeZone), clock.timeZone);
  if (occurredAt.getTime() > now.getTime() + 5 * 60 * 1000) {
    throw new DomainError("A interação não pode ter data no futuro. Use “Próxima ação” para agendar um contato.", {
      fieldErrors: { occurredDate: ["Data no futuro."] },
    });
  }
  return occurredAt;
}

export async function addLeadInteraction(
  db: DbClient,
  actor: Actor,
  leadId: string,
  input: InteractionInput,
  clock: ServiceClock,
) {
  assertPermission(actor, "leads:write");
  const now = clock.now ?? new Date();
  const occurredAt = resolveOccurredAt(input, clock);

  return db.$transaction(async (tx) => {
    const lead = await tx.lead.findUnique({
      where: { id: leadId },
      select: { id: true, status: true, peakStatus: true, patientId: true, lastContactAt: true },
    });
    if (!lead) throw new NotFoundError("Lead");

    const interaction = await tx.interaction.create({
      data: {
        leadId: lead.id,
        patientId: lead.patientId,
        type: input.type,
        direction: input.type === "NOTE" ? null : (input.direction ?? null),
        content: input.content,
        occurredAt,
        authorId: actor.id,
      },
    });

    const isContact = CONTACT_TYPES.has(input.type);
    const data: Prisma.LeadUncheckedUpdateInput = {};
    if (isContact && (!lead.lastContactAt || lead.lastContactAt < occurredAt)) data.lastContactAt = occurredAt;
    // Um contato realizado conclui a próxima ação pendente; a nova (se houver) a substitui.
    if (isContact || input.nextActionDate) {
      data.nextActionAt = nextActionFrom(input, clock.timeZone);
      data.nextActionNote = input.nextActionDate ? (input.nextActionNote ?? null) : null;
    }

    if (isContact && lead.status === "NEW") {
      data.status = "IN_PROGRESS";
      data.peakStatus = higherStage(lead.peakStatus, "IN_PROGRESS");
      data.statusChangedAt = now;
      await tx.interaction.create({
        data: {
          leadId: lead.id,
          type: "STATUS_CHANGE",
          fromStatus: "NEW",
          toStatus: "IN_PROGRESS",
          content: "Movido automaticamente após o primeiro contato registrado.",
          authorId: actor.id,
          occurredAt: now,
        },
      });
      await recordAudit(tx, {
        ...auditContext(actor),
        action: "lead.status.change",
        entityType: "lead",
        entityId: lead.id,
        metadata: { from: "NEW", to: "IN_PROGRESS", automatic: true },
      });
    }

    if (Object.keys(data).length > 0) await tx.lead.update({ where: { id: lead.id }, data });

    await recordAudit(tx, {
      ...auditContext(actor),
      action: "lead.interaction.create",
      entityType: "lead",
      entityId: lead.id,
      metadata: { type: input.type },
    });
    return interaction;
  });
}

/** Pacientes com o mesmo telefone do lead (para oferecer vínculo na conversão). */
export async function findPatientMatchesForLead(db: DbClient, leadId: string) {
  const lead = await db.lead.findUnique({ where: { id: leadId }, select: { phone: true } });
  if (!lead) throw new NotFoundError("Lead");
  return db.patient.findMany({
    where: { phone: lead.phone, lead: { is: null } },
    select: { id: true, fullName: true, createdAt: true },
    take: 5,
  });
}

export async function convertLeadToPatient(
  db: DbClient,
  actor: Actor,
  leadId: string,
  input: LeadConvertInput,
  clock: ServiceClock & { reminders?: ReminderSettings },
) {
  assertPermission(actor, "leads:write");
  assertPermission(actor, "patients:write");
  const now = clock.now ?? new Date();

  try {
    return await db.$transaction(async (tx) => {
      const lead = await tx.lead.findUnique({ where: { id: leadId } });
      if (!lead) throw new NotFoundError("Lead");
      if (lead.patientId || lead.status === "CONVERTED") {
        throw new DomainError("Este lead já foi convertido em paciente.", {
          code: "already_converted",
          meta: lead.patientId ? { patientId: lead.patientId } : undefined,
        });
      }

      let patientId: string;
      if (input.mode === "link") {
        const existing = await tx.patient.findUnique({
          where: { id: input.existingPatientId! },
          select: { id: true, lead: { select: { id: true } } },
        });
        if (!existing) throw new NotFoundError("Paciente");
        if (existing.lead) throw new DomainError("Este paciente já está vinculado a outro lead.");
        patientId = existing.id;
      } else {
        const samePhone = await tx.patient.findFirst({
          where: { phone: lead.phone },
          select: { id: true, fullName: true },
        });
        if (samePhone && !input.confirmDuplicatePhone) {
          throw new DomainError(
            `Já existe paciente com este telefone (${samePhone.fullName}). Vincule ao cadastro existente ou confirme que é outra pessoa.`,
            { code: "patient_phone_exists", meta: { existingPatientId: samePhone.id } },
          );
        }
        const keepsOptIn = input.whatsappOptIn && lead.whatsappOptIn && lead.whatsappOptInAt;
        const patient = await tx.patient.create({
          data: {
            fullName: input.fullName,
            phone: lead.phone,
            email: input.email ?? lead.email,
            birthDate: input.birthDate ? dateKeyToDbDate(input.birthDate) : null,
            source: lead.source,
            sourceDetail: lead.sourceDetail,
            whatsappOptIn: input.whatsappOptIn,
            whatsappOptInAt: input.whatsappOptIn ? (keepsOptIn ? lead.whatsappOptInAt : now) : null,
          },
        });
        patientId = patient.id;
        await recordAudit(tx, {
          ...auditContext(actor),
          action: "patient.create",
          entityType: "patient",
          entityId: patient.id,
          metadata: { origin: "lead_conversion" },
        });
        if (input.whatsappOptIn && !keepsOptIn) {
          await recordStaffConsentChange(tx, { phone: lead.phone, purpose: "WHATSAPP", granted: true, actorId: actor.id, patientId });
        }
      }

      // Condicional: impede duas conversões simultâneas do mesmo lead.
      const converted = await tx.lead.updateMany({
        where: { id: lead.id, patientId: null },
        data: {
          patientId,
          status: "CONVERTED",
          peakStatus: "CONVERTED",
          convertedAt: now,
          statusChangedAt: now,
          lostReason: null,
          lostAt: null,
          nextActionAt: null,
          nextActionNote: null,
        },
      });
      if (converted.count === 0) {
        throw new DomainError("Este lead acabou de ser convertido por outra pessoa.", { code: "already_converted" });
      }

      // O histórico comercial passa a aparecer também na ficha do paciente.
      await tx.interaction.updateMany({ where: { leadId: lead.id, patientId: null }, data: { patientId } });
      await tx.appointment.updateMany({ where: { leadId: lead.id, patientId: null }, data: { patientId } });
      await tx.whatsAppConversation.updateMany({ where: { leadId: lead.id, patientId: null }, data: { patientId } });

      // Horários futuros passam a ter lembrete (se o paciente autorizou o WhatsApp).
      const upcoming = await tx.appointment.findMany({
        where: { leadId: lead.id, patientId, status: { in: ["SCHEDULED", "CONFIRMED"] }, startsAt: { gt: now } },
        select: { id: true, patientId: true, procedureId: true, startsAt: true },
      });
      for (const appointment of upcoming) {
        await scheduleAppointmentReminder(tx, appointment, clock.reminders ?? DEFAULT_REMINDER_SETTINGS, now);
      }

      await tx.interaction.create({
        data: {
          leadId: lead.id,
          patientId,
          type: "STATUS_CHANGE",
          fromStatus: lead.status,
          toStatus: "CONVERTED",
          content: input.mode === "link" ? "Vinculado a um cadastro de paciente existente." : "Convertido em paciente.",
          authorId: actor.id,
          occurredAt: now,
        },
      });
      await recordAudit(tx, {
        ...auditContext(actor),
        action: "lead.convert",
        entityType: "lead",
        entityId: lead.id,
        metadata: { from: lead.status, mode: input.mode },
      });
      return { patientId };
    });
  } catch (error) {
    if (isUniqueViolation(error, "patient_id")) {
      throw new DomainError("Este paciente já está vinculado a outro lead.");
    }
    throw error;
  }
}

export async function deleteLead(db: DbClient, actor: Actor, leadId: string) {
  assertPermission(actor, "leads:delete");
  return db.$transaction(async (tx) => {
    const lead = await tx.lead.findUnique({
      where: { id: leadId },
      select: { id: true, patientId: true, _count: { select: { appointments: true } } },
    });
    if (!lead) throw new NotFoundError("Lead");
    if (lead.patientId) {
      throw new DomainError("Leads convertidos fazem parte do histórico do paciente e não podem ser excluídos.");
    }
    if (lead._count.appointments > 0) {
      throw new DomainError("Este lead tem agendamentos vinculados. Marque-o como perdido em vez de excluir.");
    }
    await tx.lead.delete({ where: { id: lead.id } });
    await recordAudit(tx, { ...auditContext(actor), action: "lead.delete", entityType: "lead", entityId: lead.id });
  });
}

/** Mensagem curta para toasts de mudança de etapa. */
export function describeStageMove(status: LeadStatus): string {
  return `Lead movido para ${LEAD_STATUS_LABELS[status]}.`;
}

/** Usado pela agenda: um lead com avaliação marcada avança para "Agendado". */
export async function markLeadScheduled(tx: Prisma.TransactionClient, actor: Actor, leadId: string, now: Date) {
  const lead = await tx.lead.findUnique({ where: { id: leadId }, select: { id: true, status: true, peakStatus: true } });
  if (!lead || (lead.status !== "NEW" && lead.status !== "IN_PROGRESS")) return;
  await tx.lead.update({
    where: { id: lead.id },
    data: { status: "SCHEDULED", peakStatus: higherStage(lead.peakStatus, "SCHEDULED"), statusChangedAt: now },
  });
  await tx.interaction.create({
    data: {
      leadId: lead.id,
      type: "STATUS_CHANGE",
      fromStatus: lead.status,
      toStatus: "SCHEDULED",
      content: "Movido automaticamente ao criar um agendamento.",
      authorId: actor.id,
      occurredAt: now,
    },
  });
  await recordAudit(tx, {
    ...auditContext(actor),
    action: "lead.status.change",
    entityType: "lead",
    entityId: lead.id,
    metadata: { from: lead.status, to: "SCHEDULED", automatic: true },
  });
}

/**
 * Usado pela agenda: um lead "Agendado" que ficou sem nenhum horário ativo
 * (cancelamento ou falta) volta para "Em atendimento".
 */
export async function revertLeadIfUnscheduled(tx: Prisma.TransactionClient, actor: Actor, leadId: string, now: Date) {
  const lead = await tx.lead.findUnique({ where: { id: leadId }, select: { id: true, status: true } });
  if (!lead || lead.status !== "SCHEDULED") return;
  const active = await tx.appointment.count({ where: { leadId, status: { in: ["SCHEDULED", "CONFIRMED"] } } });
  if (active > 0) return;

  await tx.lead.update({ where: { id: lead.id }, data: { status: "IN_PROGRESS", statusChangedAt: now } });
  await tx.interaction.create({
    data: {
      leadId: lead.id,
      type: "STATUS_CHANGE",
      fromStatus: "SCHEDULED",
      toStatus: "IN_PROGRESS",
      content: "Movido automaticamente: o agendamento foi cancelado ou o lead não compareceu.",
      authorId: actor.id,
      occurredAt: now,
    },
  });
  await recordAudit(tx, {
    ...auditContext(actor),
    action: "lead.status.change",
    entityType: "lead",
    entityId: lead.id,
    metadata: { from: "SCHEDULED", to: "IN_PROGRESS", automatic: true },
  });
}

