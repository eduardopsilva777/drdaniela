import { randomBytes } from "node:crypto";

import { loadEnvConfig } from "@next/env";

import type { UserRole } from "@/generated/prisma/enums";
import { hashPassword } from "@/server/auth/password";
import { createPrismaClient, type DbClient } from "@/server/db/prisma";
import type { CareClock } from "@/server/services/care-plan";
import type { Actor } from "@/server/services/context";

import { assertDisposableTestDatabase } from "./test-database-guard";

loadEnvConfig(process.cwd(), true, { info: () => {}, error: console.error });

export function createTestDb(): DbClient {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL não definida.");
  assertDisposableTestDatabase(url);
  return createPrismaClient(url);
}

/** Esvazia todas as tabelas (TRUNCATE não aciona o trigger da auditoria). */
export async function resetDatabase(db: DbClient): Promise<void> {
  const tables = await db.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;
  if (tables.length === 0) return;
  const list = tables.map(({ tablename }) => `"public"."${tablename}"`).join(", ");
  await db.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

let cachedHash: Promise<string> | undefined;
export const TEST_PASSWORD = "senha-de-teste-segura-123";

export async function createTestUser(
  db: DbClient,
  overrides: Partial<{ name: string; email: string; role: UserRole; isActive: boolean }> = {},
) {
  cachedHash ??= hashPassword(TEST_PASSWORD);
  return db.user.create({
    data: {
      name: overrides.name ?? "Pessoa Teste",
      email: overrides.email ?? `pessoa-${crypto.randomUUID()}@teste.test`,
      role: overrides.role ?? "RECEPTION",
      isActive: overrides.isActive ?? true,
      passwordHash: await cachedHash,
    },
  });
}

// -----------------------------------------------------------------------------
// Apoio aos testes dos módulos do CRM
// -----------------------------------------------------------------------------

export const TZ = "America/Sao_Paulo";

/** Instante fixo dos testes: segunda-feira, 02/11/2026, 10:00 em São Paulo. */
export const NOW = new Date("2026-11-02T10:00:00-03:00");

export const CLOCK: CareClock = {
  timeZone: TZ,
  now: NOW,
  reminders: { appointmentHoursBefore: 24, returnDaysBefore: 2, sendTime: "09:00" },
};

/** Relógio em outro instante (ex.: para concluir um atendimento depois do horário). */
export function clockAt(iso: string): CareClock {
  return { ...CLOCK, now: new Date(iso) };
}

export function actorOf(user: { id: string; name: string; role: UserRole }): Actor {
  return { id: user.id, name: user.name, role: user.role, ipAddress: "127.0.0.1", userAgent: "vitest" };
}

/** Equipe típica: administração, profissional e recepção (com o Actor de cada uma). */
export async function createTeam(db: DbClient) {
  const [admin, professional, reception] = await Promise.all([
    createTestUser(db, { name: "Helena Admin", role: "ADMIN" }),
    createTestUser(db, { name: "Daniela Profissional", role: "PROFESSIONAL" }),
    createTestUser(db, { name: "Rafaela Recepção", role: "RECEPTION" }),
  ]);
  return {
    admin,
    professional,
    reception,
    asAdmin: actorOf(admin),
    asProfessional: actorOf(professional),
    asReception: actorOf(reception),
  };
}

let phoneSequence = 0;

/** Celular brasileiro válido e único por chamada, em E.164. */
export function uniquePhone(): string {
  phoneSequence += 1;
  return `+55119${String(70000000 + phoneSequence).padStart(8, "0")}`;
}

export async function createTestPatient(
  db: DbClient,
  overrides: Partial<{ fullName: string; phone: string; whatsappOptIn: boolean; isActive: boolean }> = {},
) {
  return db.patient.create({
    data: {
      fullName: overrides.fullName ?? "Paciente Teste",
      phone: overrides.phone ?? uniquePhone(),
      whatsappOptIn: overrides.whatsappOptIn ?? false,
      whatsappOptInAt: overrides.whatsappOptIn ? NOW : null,
      isActive: overrides.isActive ?? true,
    },
  });
}

export async function createTestProcedure(
  db: DbClient,
  overrides: Partial<{ name: string; durationMinutes: number; suggestedReturnDays: number | null }> = {},
) {
  return db.procedure.create({
    data: {
      name: overrides.name ?? `Procedimento ${crypto.randomUUID().slice(0, 8)}`,
      durationMinutes: overrides.durationMinutes ?? 60,
      suggestedReturnDays: overrides.suggestedReturnDays ?? null,
    },
  });
}

/** Chave AES-256 aleatória para os testes de cifragem. */
export function testEncryptionKey(): Buffer {
  return randomBytes(32);
}
