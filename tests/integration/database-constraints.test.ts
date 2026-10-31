import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { recordAudit } from "@/server/audit";

import { createTestDb, createTestUser, resetDatabase } from "./helpers";

const db = createTestDb();

beforeEach(() => resetDatabase(db));
afterAll(() => db.$disconnect());

async function createPatient(phone = "+5511987654321") {
  return db.patient.create({ data: { fullName: "Paciente Teste", phone } });
}

describe("auditoria somente inserção", () => {
  it("não permite alterar nem apagar registros de auditoria", async () => {
    const user = await createTestUser(db);
    await recordAudit(db, { actorId: user.id, action: "auth.logout", metadata: { source: "teste" } });
    const entry = await db.auditLog.findFirstOrThrow();

    await expect(
      db.auditLog.update({ where: { id: entry.id }, data: { action: "auth.login.success" } }),
    ).rejects.toThrow(/append-only/);
    await expect(db.auditLog.delete({ where: { id: entry.id } })).rejects.toThrow(/append-only/);
    await expect(db.auditLog.count()).resolves.toBe(1);
  });

  it("impede excluir um usuário que possui histórico de auditoria", async () => {
    const user = await createTestUser(db);
    await recordAudit(db, { actorId: user.id, action: "auth.logout" });
    await expect(db.user.delete({ where: { id: user.id } })).rejects.toThrow();
  });

  it("aplica redação defensiva ao metadata", async () => {
    await recordAudit(db, { action: "auth.logout", metadata: { email: "x@y.com", note: "ok" } });
    const entry = await db.auditLog.findFirstOrThrow();
    expect(entry.metadata).toEqual({ email: "[REDACTED]", note: "[REDACTED]" });
  });
});

describe("agenda sem conflitos de horário", () => {
  const slot = (start: string, end: string) => ({
    startsAt: new Date(`2026-11-03T${start}:00-03:00`),
    endsAt: new Date(`2026-11-03T${end}:00-03:00`),
  });

  it("rejeita agendamentos sobrepostos para o mesmo profissional", async () => {
    const professional = await createTestUser(db, { role: "PROFESSIONAL" });
    const patient = await createPatient();
    await db.appointment.create({
      data: { professionalId: professional.id, patientId: patient.id, ...slot("09:00", "10:00") },
    });

    await expect(
      db.appointment.create({
        data: { professionalId: professional.id, patientId: patient.id, ...slot("09:30", "10:30") },
      }),
    ).rejects.toThrow(/appointments_no_overlap/);
  });

  it("permite horários encostados, outro profissional e horários de agendamentos cancelados", async () => {
    const daniela = await createTestUser(db, { role: "PROFESSIONAL" });
    const outra = await createTestUser(db, { role: "PROFESSIONAL" });
    const patient = await createPatient();

    const cancelled = await db.appointment.create({
      data: { professionalId: daniela.id, patientId: patient.id, ...slot("09:00", "10:00") },
    });
    await db.appointment.update({
      where: { id: cancelled.id },
      data: { status: "CANCELLED", cancelledAt: new Date() },
    });

    await db.appointment.create({
      data: { professionalId: daniela.id, patientId: patient.id, ...slot("09:00", "10:00") },
    });
    await db.appointment.create({
      data: { professionalId: daniela.id, patientId: patient.id, ...slot("10:00", "11:00") },
    });
    await db.appointment.create({
      data: { professionalId: outra.id, patientId: patient.id, ...slot("09:00", "10:00") },
    });

    await expect(db.appointment.count({ where: { status: { not: "CANCELLED" } } })).resolves.toBe(3);
  });

  it("não permite reativar um agendamento cancelado se o horário já foi ocupado", async () => {
    const professional = await createTestUser(db, { role: "PROFESSIONAL" });
    const patient = await createPatient();
    const cancelled = await db.appointment.create({
      data: { professionalId: professional.id, patientId: patient.id, status: "CANCELLED", ...slot("14:00", "15:00") },
    });
    await db.appointment.create({
      data: { professionalId: professional.id, patientId: patient.id, ...slot("14:30", "15:30") },
    });
    await expect(
      db.appointment.update({ where: { id: cancelled.id }, data: { status: "SCHEDULED" } }),
    ).rejects.toThrow(/appointments_no_overlap/);
  });

  it("exige término após o início e um paciente ou lead vinculado", async () => {
    const professional = await createTestUser(db, { role: "PROFESSIONAL" });
    const patient = await createPatient();

    await expect(
      db.appointment.create({
        data: { professionalId: professional.id, patientId: patient.id, ...slot("11:00", "10:00") },
      }),
    ).rejects.toThrow(/appointments_time_range_check/);

    await expect(
      db.appointment.create({ data: { professionalId: professional.id, ...slot("12:00", "13:00") } }),
    ).rejects.toThrow(/appointments_subject_check/);
  });
});

describe("consistência de cadastro", () => {
  it("exige telefones no formato E.164", async () => {
    await expect(createPatient("(11) 98765-4321")).rejects.toThrow(/patients_phone_e164_check/);
    await expect(createPatient("+5511987654321")).resolves.toBeDefined();
  });

  it("exige e-mails de usuários em minúsculas", async () => {
    await expect(createTestUser(db, { email: "Maiuscula@Clinica.test" })).rejects.toThrow(
      /users_email_lowercase_check/,
    );
  });
});
