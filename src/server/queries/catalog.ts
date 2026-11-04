import "server-only";

import { requirePermission, requireUser } from "@/server/auth/dal";
import { getDb } from "@/server/db";

/**
 * Listas de apoio usadas por vários módulos (selects de formulários e filtros).
 * Retornam apenas os campos necessários para exibição.
 */

export interface ProcedureOption {
  id: string;
  name: string;
  durationMinutes: number;
  color: string | null;
  suggestedReturnDays: number | null;
}

export async function getActiveProcedureOptions(): Promise<ProcedureOption[]> {
  await requirePermission("procedures:read");
  return getDb().procedure.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, durationMinutes: true, color: true, suggestedReturnDays: true },
  });
}

export interface StaffOption {
  id: string;
  name: string;
}

/** Membros ativos da equipe (responsáveis por leads). */
export async function getStaffOptions(): Promise<StaffOption[]> {
  await requireUser();
  return getDb().user.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
}

/** Quem pode realizar atendimentos na agenda: perfis Profissional e Administração. */
export async function getProfessionalOptions(): Promise<StaffOption[]> {
  await requirePermission("appointments:read");
  return getDb().user.findMany({
    where: { isActive: true, role: { in: ["PROFESSIONAL", "ADMIN"] } },
    orderBy: [{ role: "desc" }, { name: "asc" }],
    select: { id: true, name: true },
  });
}

export interface ProtocolOption {
  id: string;
  name: string;
  procedureName: string;
  stepsSummary: string;
}

/** Protocolos ativos para aplicar a um paciente, com o resumo das etapas. */
export async function getProtocolOptions(): Promise<ProtocolOption[]> {
  await requirePermission("procedures:read");
  const rows = await getDb().protocol.findMany({
    where: { isActive: true, procedure: { isActive: true } },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      procedure: { select: { name: true } },
      steps: { orderBy: { position: "asc" }, select: { label: true, offsetDays: true, relativeTo: true } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    procedureName: row.procedure.name,
    stepsSummary: row.steps
      .map((step) => `${step.label} (+${step.offsetDays} d ${step.relativeTo === "START" ? "do início" : "da anterior"})`)
      .join(" · "),
  }));
}

export interface ProcedureRow {
  id: string;
  name: string;
  category: string | null;
  description: string | null;
  durationMinutes: number;
  priceCents: number | null;
  suggestedReturnDays: number | null;
  color: string | null;
  isActive: boolean;
  protocolCount: number;
}

export async function listProcedures(includeInactive: boolean): Promise<ProcedureRow[]> {
  await requirePermission("procedures:read");
  const rows = await getDb().procedure.findMany({
    where: includeInactive ? undefined : { isActive: true },
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
    include: { _count: { select: { protocols: true } } },
  });
  return rows.map(({ _count, createdAt: _createdAt, updatedAt: _updatedAt, ...row }) => ({
    ...row,
    protocolCount: _count.protocols,
  }));
}
