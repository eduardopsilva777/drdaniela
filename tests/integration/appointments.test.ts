import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { appointmentCreateSchema } from "@/lib/validation/appointments";
import { DomainError } from "@/server/errors";
import {
  canTransition,
  changeAppointmentStatus,
  createAppointment,
  rescheduleAppointment,
  updateAppointmentDetails,
} from "@/server/services/appointments";

import {
  CLOCK,
  clockAt,
  createTeam,
  createTestDb,
  createTestPatient,
  createTestProcedure,
  createTestUser,
  resetDatabase,
} from "./helpers";

const db = createTestDb();

beforeEach(() => resetDatabase(db));
afterAll(() => db.$disconnect());

type Team = Awaited<ReturnType<typeof createTeam>>;

function input(team: Team, values: Record<string, unknown>) {
  return appointmentCreateSchema.parse({
    subject: "patient",
    professionalId: team.professional.id,
    date: "2026-11-04",
    startTime: "09:00",
    durationMinutes: 60,
    ...values,
  });
}

async function errorOf(promise: Promise<unknown>): Promise<DomainError> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(DomainError);
  return error as DomainError;
}

describe("criação de agendamentos", () => {
  it("grava o horário no fuso da clínica, o histórico e o lembrete (com consentimento)", async () => {
    const team = await createTeam(db);
    const patient = await createTestPatient(db, { whatsappOptIn: true });
    const appointment = await createAppointment(db, team.asReception, input(team, { patientId: patient.id }), CLOCK);

    expect(appointment.startsAt.toISOString()).toBe("2026-11-04T12:00:00.000Z");
    expect(appointment.endsAt.toISOString()).toBe("2026-11-04T13:00:00.000Z");
    expect(appointment.status).toBe("SCHEDULED");

    const events = await db.appointmentEvent.findMany({ where: { appointmentId: appointment.id } });
    expect(events).toEqual([expect.objectContaining({ type: "CREATED", toStatus: "SCHEDULED" })]);

    const reminder = await db.reminder.findFirstOrThrow({ where: { appointmentId: appointment.id } });
    expect(reminder.scheduledFor.toISOString()).toBe("2026-11-03T12:00:00.000Z"); // 24h antes
  });

  it("não cria lembrete para quem não autorizou o WhatsApp", async () => {
    const team = await createTeam(db);
    const patient = await createTestPatient(db, { whatsappOptIn: false });
    await createAppointment(db, team.asReception, input(team, { patientId: patient.id }), CLOCK);
    expect(await db.reminder.count()).toBe(0);
  });

  it("impede conflito para o mesmo profissional e explica o horário ocupado", async () => {
    const team = await createTeam(db);
    const patient = await createTestPatient(db);
    await createAppointment(db, team.asReception, input(team, { patientId: patient.id }), CLOCK);

    const error = await errorOf(
      createAppointment(db, team.asReception, input(team, { patientId: patient.id, startTime: "09:30" }), CLOCK),
    );
    expect(error.code).toBe("schedule_conflict");
    expect(error.message).toContain("09:00 às 10:00");

    // Encostado e com outra profissional: permitidos.
    await createAppointment(db, team.asReception, input(team, { patientId: patient.id, startTime: "10:00" }), CLOCK);
    const other = await createTestUser(db, { role: "PROFESSIONAL" });
    await createAppointment(
      db,
      team.asReception,
      input(team, { patientId: patient.id, startTime: "09:30", professionalId: other.id }),
      CLOCK,
    );
    expect(await db.appointment.count()).toBe(3);
  });

  it("o banco garante a regra mesmo com criações simultâneas", async () => {
    const team = await createTeam(db);
    const patient = await createTestPatient(db);
    const results = await Promise.allSettled(
      ["09:00", "09:15", "09:30"].map((startTime) =>
        createAppointment(db, team.asReception, input(team, { patientId: patient.id, startTime }), CLOCK),
      ),
    );
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    for (const result of results) {
      if (result.status === "rejected") expect((result.reason as DomainError).code).toBe("schedule_conflict");
    }
  });

  it("valida a janela de datas: passado, mais de 2 anos e virada do dia", async () => {
    const team = await createTeam(db);
    const patient = await createTestPatient(db);

    expect((await errorOf(createAppointment(db, team.asReception, input(team, { patientId: patient.id, date: "2026-11-01" }), CLOCK))).code).toBe("date_in_past");
    expect((await errorOf(createAppointment(db, team.asReception, input(team, { patientId: patient.id, date: "2029-01-10" }), CLOCK))).code).toBe("date_too_far");
    expect(
      (await errorOf(createAppointment(db, team.asReception, input(team, { patientId: patient.id, startTime: "23:30", durationMinutes: 60 }), CLOCK))).code,
    ).toBe("crosses_midnight");

    // Hoje é aceito (registro de encaixe), e terminar exatamente à meia-noite também.
    await createAppointment(db, team.asReception, input(team, { patientId: patient.id, date: "2026-11-02", startTime: "08:00" }), CLOCK);
    await createAppointment(db, team.asReception, input(team, { patientId: patient.id, startTime: "23:00", durationMinutes: 60 }), CLOCK);
  });

  it("exige profissional ativo com perfil de atendimento e paciente ativo", async () => {
    const team = await createTeam(db);
    const patient = await createTestPatient(db);
    await errorOf(createAppointment(db, team.asReception, input(team, { patientId: patient.id, professionalId: team.reception.id }), CLOCK));

    const inactive = await createTestPatient(db, { isActive: false });
    await expect(createAppointment(db, team.asReception, input(team, { patientId: inactive.id }), CLOCK)).rejects.toThrow(/inativo/);
  });
});

describe("agendamento de leads", () => {
  it("move o lead para Agendado e, se cancelado sem outro horário, volta para Em atendimento", async () => {
    const team = await createTeam(db);
    const lead = await db.lead.create({ data: { name: "Lead Demo", phone: "+5511955554444", source: "INSTAGRAM", status: "IN_PROGRESS" } });

    const appointment = await createAppointment(db, team.asReception, input(team, { subject: "lead", leadId: lead.id }), CLOCK);
    expect((await db.lead.findUniqueOrThrow({ where: { id: lead.id } })).status).toBe("SCHEDULED");

    await changeAppointmentStatus(db, team.asReception, appointment.id, { status: "CANCELLED", reason: "Desistiu" }, CLOCK);
    const stored = await db.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(stored.status).toBe("IN_PROGRESS");
    expect(stored.peakStatus).toBe("SCHEDULED");

    const changes = await db.interaction.findMany({ where: { leadId: lead.id, type: "STATUS_CHANGE" }, orderBy: { createdAt: "asc" } });
    expect(changes.map((item) => item.toStatus)).toEqual(["SCHEDULED", "IN_PROGRESS"]);
  });

  it("não agenda lead perdido", async () => {
    const team = await createTeam(db);
    const lead = await db.lead.create({ data: { name: "Lead Demo", phone: "+5511955554444", source: "OTHER", status: "LOST" } });
    await expect(createAppointment(db, team.asReception, input(team, { subject: "lead", leadId: lead.id }), CLOCK)).rejects.toThrow(/perdido/);
  });
});

describe("reagendamento e status", () => {
  it("reagendar mantém o registro, guarda o horário anterior e exige nova confirmação", async () => {
    const team = await createTeam(db);
    const patient = await createTestPatient(db, { whatsappOptIn: true });
    const appointment = await createAppointment(db, team.asReception, input(team, { patientId: patient.id }), CLOCK);
    await changeAppointmentStatus(db, team.asReception, appointment.id, { status: "CONFIRMED" }, CLOCK);

    await rescheduleAppointment(
      db,
      team.asReception,
      appointment.id,
      { date: "2026-11-05", startTime: "14:00", durationMinutes: 45, reason: "Pedido da paciente" },
      CLOCK,
    );

    const stored = await db.appointment.findUniqueOrThrow({ where: { id: appointment.id } });
    expect(stored).toMatchObject({ status: "SCHEDULED", confirmedAt: null });
    expect(stored.startsAt.toISOString()).toBe("2026-11-05T17:00:00.000Z");

    const event = await db.appointmentEvent.findFirstOrThrow({ where: { appointmentId: appointment.id, type: "RESCHEDULED" } });
    expect(event).toMatchObject({ fromStatus: "CONFIRMED", reason: "Pedido da paciente" });
    expect(event.previousStartsAt?.toISOString()).toBe("2026-11-04T12:00:00.000Z");

    const reminders = await db.reminder.findMany({ where: { appointmentId: appointment.id }, orderBy: { createdAt: "asc" } });
    expect(reminders.map((reminder) => reminder.status)).toEqual(["CANCELLED", "PENDING"]);
  });

  it("reagendar respeita conflitos e a janela de datas", async () => {
    const team = await createTeam(db);
    const patient = await createTestPatient(db);
    await createAppointment(db, team.asReception, input(team, { patientId: patient.id, startTime: "14:00" }), CLOCK);
    const appointment = await createAppointment(db, team.asReception, input(team, { patientId: patient.id }), CLOCK);

    expect(
      (await errorOf(rescheduleAppointment(db, team.asReception, appointment.id, { date: "2026-11-04", startTime: "13:30", durationMinutes: 60 }, CLOCK))).code,
    ).toBe("schedule_conflict");
    expect(
      (await errorOf(rescheduleAppointment(db, team.asReception, appointment.id, { date: "2026-10-30", startTime: "13:30", durationMinutes: 60 }, CLOCK))).code,
    ).toBe("date_in_past");
  });

  it("conclusão só depois do início e gera o procedimento realizado", async () => {
    const team = await createTeam(db);
    const patient = await createTestPatient(db);
    const procedure = await createTestProcedure(db);
    const appointment = await createAppointment(
      db,
      team.asReception,
      input(team, { patientId: patient.id, procedureId: procedure.id }),
      CLOCK,
    );

    await expect(changeAppointmentStatus(db, team.asReception, appointment.id, { status: "COMPLETED" }, CLOCK)).rejects.toThrow(
      /depois do horário/,
    );
    await changeAppointmentStatus(db, team.asReception, appointment.id, { status: "COMPLETED" }, clockAt("2026-11-04T10:30:00-03:00"));

    const record = await db.procedureRecord.findFirstOrThrow({ where: { appointmentId: appointment.id } });
    expect(record).toMatchObject({ patientId: patient.id, procedureId: procedure.id, professionalId: team.professional.id });
  });

  it("cancelado e não comparecido são finais, com remarcação ligada ao original", async () => {
    const team = await createTeam(db);
    const patient = await createTestPatient(db);
    const appointment = await createAppointment(db, team.asReception, input(team, { patientId: patient.id }), CLOCK);
    await changeAppointmentStatus(db, team.asReception, appointment.id, { status: "CANCELLED", reason: "Imprevisto" }, CLOCK);

    const invalid = await errorOf(changeAppointmentStatus(db, team.asReception, appointment.id, { status: "CONFIRMED" }, CLOCK));
    expect(invalid.code).toBe("invalid_transition");

    // O horário cancelado fica livre e a remarcação aponta para o original.
    const rebooked = await createAppointment(
      db,
      team.asReception,
      input(team, { patientId: patient.id, rescheduledFromId: appointment.id }),
      CLOCK,
    );
    expect(rebooked.rescheduledFromId).toBe(appointment.id);
    await expect(
      createAppointment(db, team.asReception, input(team, { patientId: patient.id, startTime: "15:00", rescheduledFromId: appointment.id }), CLOCK),
    ).rejects.toThrow(/já foi remarcado/);

    const cancelled = await db.appointment.findUniqueOrThrow({ where: { id: appointment.id } });
    expect(cancelled).toMatchObject({ status: "CANCELLED", cancellationReason: "Imprevisto" });
  });

  it("matriz de transições permitidas", () => {
    expect(canTransition("SCHEDULED", "CONFIRMED")).toBe(true);
    expect(canTransition("CONFIRMED", "SCHEDULED")).toBe(true);
    expect(canTransition("SCHEDULED", "NO_SHOW")).toBe(true);
    expect(canTransition("COMPLETED", "CANCELLED")).toBe(false);
    expect(canTransition("NO_SHOW", "SCHEDULED")).toBe(false);
  });

  it("trocar a profissional verifica conflito na agenda dela", async () => {
    const team = await createTeam(db);
    const other = await createTestUser(db, { role: "PROFESSIONAL" });
    const patient = await createTestPatient(db);
    await createAppointment(db, team.asReception, input(team, { patientId: patient.id, professionalId: other.id }), CLOCK);
    const appointment = await createAppointment(db, team.asReception, input(team, { patientId: patient.id }), CLOCK);

    const error = await errorOf(
      updateAppointmentDetails(db, team.asReception, appointment.id, { professionalId: other.id }, CLOCK),
    );
    expect(error.code).toBe("schedule_conflict");
  });
});
