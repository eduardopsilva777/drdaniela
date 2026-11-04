import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { phoneDigits } from "@/lib/phone";
import type { PatientFilters } from "@/lib/validation/patients";
import { requirePermission } from "@/server/auth/dal";
import { openMessageBodies } from "@/server/crypto/content-cipher";
import { getContentKeyring } from "@/server/crypto/content-key";
import { getDb } from "@/server/db";
import { NotFoundError } from "@/server/errors";

export const PATIENTS_PAGE_SIZE = 20;

function searchWhere(query: string | undefined): Prisma.PatientWhereInput {
  if (!query) return {};
  const digits = phoneDigits(query);
  return {
    OR: [
      { fullName: { contains: query, mode: "insensitive" } },
      { preferredName: { contains: query, mode: "insensitive" } },
      { email: { contains: query, mode: "insensitive" } },
      ...(digits.length >= 3 ? [{ phone: { contains: digits } }] : []),
    ],
  };
}

const ORDER: Record<PatientFilters["ordem"], Prisma.PatientOrderByWithRelationInput[]> = {
  nome: [{ fullName: "asc" }],
  recentes: [{ createdAt: "desc" }],
  antigos: [{ createdAt: "asc" }],
};

export async function listPatients(filters: PatientFilters, now: Date = new Date()) {
  await requirePermission("patients:read");
  const db = getDb();
  const where: Prisma.PatientWhereInput = {
    AND: [
      searchWhere(filters.busca),
      filters.situacao === "todos" ? {} : { isActive: filters.situacao === "ativos" },
    ],
  };
  const [total, items] = await Promise.all([
    db.patient.count({ where }),
    db.patient.findMany({
      where,
      orderBy: ORDER[filters.ordem],
      skip: (filters.pagina - 1) * PATIENTS_PAGE_SIZE,
      take: PATIENTS_PAGE_SIZE,
      select: {
        id: true,
        fullName: true,
        preferredName: true,
        phone: true,
        isActive: true,
        createdAt: true,
        whatsappOptIn: true,
        appointments: {
          where: { startsAt: { gte: now }, status: { in: ["SCHEDULED", "CONFIRMED"] } },
          orderBy: { startsAt: "asc" },
          take: 1,
          select: { startsAt: true },
        },
        _count: { select: { returns: { where: { status: "PENDING" } } } },
      },
    }),
  ]);
  return { total, items };
}

export async function getPatientProfile(patientId: string) {
  await requirePermission("patients:read");
  const patient = await getDb().patient.findUnique({
    where: { id: patientId },
    include: {
      lead: {
        select: {
          id: true,
          source: true,
          sourceDetail: true,
          interest: true,
          createdAt: true,
          convertedAt: true,
          procedure: { select: { name: true } },
        },
      },
    },
  });
  if (!patient) throw new NotFoundError("Paciente");
  return patient;
}

export type PatientProfile = Awaited<ReturnType<typeof getPatientProfile>>;

export async function getPatientOverview(patientId: string, now: Date) {
  await requirePermission("patients:read");
  const db = getDb();
  const [upcomingAppointments, pendingReturns, activeProtocols, lastRecord] = await Promise.all([
    db.appointment.findMany({
      where: { patientId, startsAt: { gte: now }, status: { in: ["SCHEDULED", "CONFIRMED"] } },
      orderBy: { startsAt: "asc" },
      take: 3,
      select: { id: true, startsAt: true, status: true, procedure: { select: { name: true } }, professional: { select: { name: true } } },
    }),
    db.patientReturn.findMany({
      where: { patientId, status: { in: ["PENDING", "SCHEDULED"] } },
      orderBy: { dueDate: "asc" },
      take: 4,
      select: { id: true, title: true, dueDate: true, status: true },
    }),
    db.patientProtocol.findMany({
      where: { patientId, status: "ACTIVE" },
      select: { id: true, startedOn: true, protocol: { select: { name: true } } },
    }),
    db.procedureRecord.findFirst({
      where: { patientId },
      orderBy: { performedAt: "desc" },
      select: { performedAt: true, procedure: { select: { name: true } } },
    }),
  ]);
  return { upcomingAppointments, pendingReturns, activeProtocols, lastRecord };
}

export async function getPatientAppointments(patientId: string) {
  await requirePermission("appointments:read");
  return getDb().appointment.findMany({
    where: { patientId },
    orderBy: { startsAt: "desc" },
    take: 100,
    select: {
      id: true,
      startsAt: true,
      endsAt: true,
      status: true,
      cancellationReason: true,
      procedure: { select: { name: true } },
      professional: { select: { name: true } },
    },
  });
}

export async function getPatientProcedureRecords(patientId: string) {
  await requirePermission("patients:read");
  return getDb().procedureRecord.findMany({
    where: { patientId },
    orderBy: { performedAt: "desc" },
    take: 100,
    select: {
      id: true,
      performedAt: true,
      notes: true,
      procedure: { select: { name: true } },
      professional: { select: { name: true } },
      patientProtocol: { select: { protocol: { select: { name: true } } } },
      protocolStep: { select: { label: true } },
    },
  });
}

export async function getPatientInteractions(patientId: string) {
  await requirePermission("patients:read");
  return getDb().interaction.findMany({
    where: { patientId },
    orderBy: { occurredAt: "desc" },
    take: 200,
    include: { author: { select: { name: true } } },
  });
}

export async function getPatientMessages(patientId: string) {
  await requirePermission("whatsapp:read");
  const conversations = await getDb().whatsAppConversation.findMany({
    where: { patientId },
    select: {
      id: true,
      contactPhone: true,
      messages: {
        orderBy: { createdAt: "desc" },
        take: 50,
        select: { id: true, direction: true, body: true, status: true, createdAt: true, templateName: true, provider: true },
      },
    },
  });
  // O texto das mensagens é gravado cifrado: decifra para exibir na ficha.
  const keyring = getContentKeyring();
  return conversations.map((conversation) => ({
    ...conversation,
    messages: openMessageBodies(conversation.id, conversation.messages, keyring),
  }));
}

/** Protocolos aplicados, retornos e lembretes do paciente (aba "Protocolos e retornos"). */
export async function getPatientCare(patientId: string) {
  await requirePermission("returns:read");
  const db = getDb();
  const [protocols, returns, reminders] = await Promise.all([
    db.patientProtocol.findMany({
      where: { patientId },
      orderBy: [{ status: "asc" }, { startedOn: "desc" }],
      select: {
        id: true,
        startedOn: true,
        status: true,
        notes: true,
        cancellationReason: true,
        protocol: { select: { name: true, procedure: { select: { name: true } } } },
      },
    }),
    db.patientReturn.findMany({
      where: { patientId },
      orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
      take: 200,
      select: {
        id: true,
        title: true,
        kind: true,
        dueDate: true,
        status: true,
        notes: true,
        resolvedAt: true,
        patientProtocolId: true,
        procedure: { select: { id: true, name: true } },
        appointment: { select: { id: true, startsAt: true, status: true } },
      },
    }),
    db.reminder.findMany({
      where: { patientId },
      orderBy: { scheduledFor: "desc" },
      take: 30,
      select: {
        id: true,
        kind: true,
        status: true,
        scheduledFor: true,
        sentAt: true,
        attempts: true,
        simulated: true,
        lastError: true,
        procedure: { select: { name: true } },
      },
    }),
  ]);
  return { protocols, returns, reminders };
}

/** Busca para seletores (agenda, protocolos, conversas). Apenas pacientes ativos. */
export async function searchPatients(query: string, limit = 8) {
  await requirePermission("patients:read");
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];
  return getDb().patient.findMany({
    where: { AND: [{ isActive: true }, searchWhere(trimmed)] },
    orderBy: { fullName: "asc" },
    take: limit,
    select: { id: true, fullName: true, phone: true },
  });
}
