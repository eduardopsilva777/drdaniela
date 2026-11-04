import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { appointmentCreateSchema } from "@/lib/validation/appointments";
import {
  applyProtocolSchema,
  procedureRecordSchema,
  protocolInputSchema,
  returnCreateSchema,
} from "@/lib/validation/care";
import { AuthorizationError } from "@/server/auth/errors";
import { DomainError } from "@/server/errors";
import { changeAppointmentStatus, createAppointment } from "@/server/services/appointments";
import {
  applyProtocolToPatient,
  cancelPatientProtocol,
  createProcedureRecord,
  createProtocol,
  createReturn,
  resolveReturn,
  updateProtocol,
  updateReturn,
} from "@/server/services/care-plan";

import {
  CLOCK,
  clockAt,
  createTeam,
  createTestDb,
  createTestPatient,
  createTestProcedure,
  resetDatabase,
} from "./helpers";

const db = createTestDb();

beforeEach(() => resetDatabase(db));
afterAll(() => db.$disconnect());

type Team = Awaited<ReturnType<typeof createTeam>>;

async function protocolFixture(team: Team) {
  const procedure = await createTestProcedure(db, { name: "Bioestimulador Demo", suggestedReturnDays: 30 });
  const protocol = await createProtocol(
    db,
    team.asProfessional,
    protocolInputSchema.parse({
      name: "Protocolo Demo",
      procedureId: procedure.id,
      steps: [
        { label: "Sessão 2", kind: "SESSION", offsetDays: 30, relativeTo: "START" },
        { label: "Revisão", kind: "REVIEW", offsetDays: 15, relativeTo: "PREVIOUS" },
        { label: "Manutenção", kind: "MAINTENANCE", offsetDays: 180, relativeTo: "START" },
      ],
    }),
  );
  return { procedure, protocol };
}

function dueKeys(returns: Array<{ title: string; dueDate: Date }>) {
  return Object.fromEntries(returns.map((item) => [item.title, item.dueDate.toISOString().slice(0, 10)]));
}

describe("catálogo de protocolos", () => {
  it("somente perfis autorizados configuram protocolos; nomes são únicos", async () => {
    const team = await createTeam(db);
    const procedure = await createTestProcedure(db);
    const input = protocolInputSchema.parse({
      name: "Protocolo Demo",
      procedureId: procedure.id,
      steps: [{ label: "Revisão", kind: "REVIEW", offsetDays: 15, relativeTo: "START" }],
    });

    await expect(createProtocol(db, team.asReception, input)).rejects.toBeInstanceOf(AuthorizationError);
    await createProtocol(db, team.asProfessional, input);
    await expect(createProtocol(db, team.asProfessional, input)).rejects.toThrow(/Já existe um protocolo/);
  });

  it("edição atualiza etapas por posição e remove as excedentes", async () => {
    const team = await createTeam(db);
    const { procedure, protocol } = await protocolFixture(team);
    await updateProtocol(
      db,
      team.asProfessional,
      protocol.id,
      protocolInputSchema.parse({
        name: "Protocolo Demo",
        procedureId: procedure.id,
        steps: [{ label: "Sessão única", kind: "SESSION", offsetDays: 21, relativeTo: "START" }],
      }),
    );
    const steps = await db.protocolStep.findMany({ where: { protocolId: protocol.id } });
    expect(steps).toEqual([expect.objectContaining({ position: 1, label: "Sessão única", offsetDays: 21 })]);
  });
});

describe("aplicação de protocolo ao paciente", () => {
  it("programa os retornos a partir dos intervalos definidos pela profissional", async () => {
    const team = await createTeam(db);
    const { protocol } = await protocolFixture(team);
    const patient = await createTestPatient(db, { whatsappOptIn: true });

    await applyProtocolToPatient(
      db,
      team.asProfessional,
      patient.id,
      applyProtocolSchema.parse({ protocolId: protocol.id, startDate: "2026-11-02", registerInitialProcedure: "on" }),
      CLOCK,
    );

    const returns = await db.patientReturn.findMany({ where: { patientId: patient.id } });
    expect(dueKeys(returns)).toEqual({
      "Sessão 2": "2026-12-02", // início + 30
      Revisão: "2026-12-17", // etapa anterior + 15
      Manutenção: "2027-05-01", // início + 180
    });
    expect(await db.procedureRecord.count({ where: { patientId: patient.id } })).toBe(1);

    // Lembrete 2 dias antes, às 09:00 no fuso da clínica.
    const reminders = await db.reminder.findMany({ where: { patientId: patient.id }, orderBy: { scheduledFor: "asc" } });
    expect(reminders).toHaveLength(3);
    expect(reminders[0]?.scheduledFor.toISOString()).toBe("2026-11-30T12:00:00.000Z");
  });

  it("não registra procedimento inicial com data futura nem aplica protocolo inativo", async () => {
    const team = await createTeam(db);
    const { protocol } = await protocolFixture(team);
    const patient = await createTestPatient(db);

    await expect(
      applyProtocolToPatient(
        db,
        team.asProfessional,
        patient.id,
        applyProtocolSchema.parse({ protocolId: protocol.id, startDate: "2026-11-10", registerInitialProcedure: "on" }),
        CLOCK,
      ),
    ).rejects.toThrow(/depois de realizado/);

    await db.protocol.update({ where: { id: protocol.id }, data: { isActive: false } });
    await expect(
      applyProtocolToPatient(db, team.asProfessional, patient.id, applyProtocolSchema.parse({ protocolId: protocol.id, startDate: "2026-11-02" }), CLOCK),
    ).rejects.toThrow(/inativo/);
  });

  it("realizar uma etapa em outra data recalcula as etapas encadeadas e conclui o protocolo no fim", async () => {
    const team = await createTeam(db);
    const { protocol } = await protocolFixture(team);
    const patient = await createTestPatient(db);
    const applied = await applyProtocolToPatient(
      db,
      team.asProfessional,
      patient.id,
      applyProtocolSchema.parse({ protocolId: protocol.id, startDate: "2026-11-02" }),
      CLOCK,
    );

    const session = await db.patientReturn.findFirstOrThrow({ where: { title: "Sessão 2" } });
    const later = clockAt("2026-12-10T10:00:00-03:00");
    await resolveReturn(db, team.asReception, session.id, { status: "COMPLETED", date: "2026-12-08" }, later);

    let returns = await db.patientReturn.findMany({ where: { patientId: patient.id } });
    expect(dueKeys(returns)).toMatchObject({ Revisão: "2026-12-23", Manutenção: "2027-05-01" });

    for (const item of returns.filter((entry) => entry.status === "PENDING")) {
      await resolveReturn(db, team.asReception, item.id, { status: "CANCELLED" }, later);
    }
    returns = await db.patientReturn.findMany({ where: { patientId: patient.id } });
    expect(returns.every((item) => item.status !== "PENDING")).toBe(true);
    expect((await db.patientProtocol.findUniqueOrThrow({ where: { id: applied.id } })).status).toBe("COMPLETED");
  });

  it("cancelar o protocolo cancela retornos e lembretes pendentes", async () => {
    const team = await createTeam(db);
    const { protocol } = await protocolFixture(team);
    const patient = await createTestPatient(db, { whatsappOptIn: true });
    const applied = await applyProtocolToPatient(
      db,
      team.asProfessional,
      patient.id,
      applyProtocolSchema.parse({ protocolId: protocol.id, startDate: "2026-11-02" }),
      CLOCK,
    );

    await expect(cancelPatientProtocol(db, team.asReception, applied.id, "Desistiu", CLOCK)).rejects.toBeInstanceOf(
      AuthorizationError,
    );
    await cancelPatientProtocol(db, team.asProfessional, applied.id, "Desistiu", CLOCK);

    expect(await db.patientReturn.count({ where: { status: "CANCELLED" } })).toBe(3);
    expect(await db.reminder.count({ where: { status: "PENDING" } })).toBe(0);
    await expect(cancelPatientProtocol(db, team.asProfessional, applied.id, "De novo", CLOCK)).rejects.toThrow(/encerrado/);
  });
});

describe("retornos avulsos e procedimentos realizados", () => {
  it("procedimento realizado pode gerar retorno com o intervalo configurado", async () => {
    const team = await createTeam(db);
    const procedure = await createTestProcedure(db, { name: "Toxina Demo", suggestedReturnDays: 15 });
    const patient = await createTestPatient(db);

    await createProcedureRecord(
      db,
      team.asReception,
      patient.id,
      procedureRecordSchema.parse({ procedureId: procedure.id, date: "2026-11-02", createReturn: "on" }),
      CLOCK,
    );
    const created = await db.patientReturn.findFirstOrThrow({ where: { patientId: patient.id } });
    expect(created).toMatchObject({ title: "Retorno de Toxina Demo", kind: "REVIEW", status: "PENDING" });
    expect(created.dueDate.toISOString().slice(0, 10)).toBe("2026-11-17");

    await expect(
      createProcedureRecord(db, team.asReception, patient.id, procedureRecordSchema.parse({ procedureId: procedure.id, date: "2026-11-09" }), CLOCK),
    ).rejects.toThrow(/futuro/);
  });

  it("nova data reabre retorno não comparecido; resolvido não pode ser alterado", async () => {
    const team = await createTeam(db);
    const patient = await createTestPatient(db);
    const { id } = await createReturn(
      db,
      team.asReception,
      patient.id,
      returnCreateSchema.parse({ title: "Revisão", dueDate: "2026-11-05" }),
      CLOCK,
    );

    const later = clockAt("2026-11-06T10:00:00-03:00");
    await resolveReturn(db, team.asReception, id, { status: "MISSED", date: "2026-11-05" }, later);
    await updateReturn(db, team.asReception, id, { dueDate: "2026-11-12" }, later);
    expect((await db.patientReturn.findUniqueOrThrow({ where: { id } })).status).toBe("PENDING");

    await resolveReturn(db, team.asReception, id, { status: "COMPLETED", date: "2026-11-06" }, later);
    await expect(updateReturn(db, team.asReception, id, { dueDate: "2026-11-20" }, later)).rejects.toBeInstanceOf(DomainError);
    await expect(resolveReturn(db, team.asReception, id, { status: "CANCELLED" }, later)).rejects.toThrow(/já foi resolvido/);
  });
});

describe("retorno vinculado à agenda", () => {
  it("agendar marca o retorno; concluir o atendimento registra o comparecimento", async () => {
    const team = await createTeam(db);
    const patient = await createTestPatient(db, { whatsappOptIn: true });
    const { id: returnId } = await createReturn(
      db,
      team.asReception,
      patient.id,
      returnCreateSchema.parse({ title: "Revisão", dueDate: "2026-11-10" }),
      CLOCK,
    );
    expect(await db.reminder.count({ where: { returnId, status: "PENDING" } })).toBe(1);

    const appointment = await createAppointment(
      db,
      team.asReception,
      appointmentCreateSchema.parse({
        subject: "patient",
        patientId: patient.id,
        professionalId: team.professional.id,
        date: "2026-11-10",
        startTime: "15:00",
        durationMinutes: 30,
        returnId,
      }),
      CLOCK,
    );

    let stored = await db.patientReturn.findUniqueOrThrow({ where: { id: returnId } });
    expect(stored).toMatchObject({ status: "SCHEDULED", appointmentId: appointment.id });
    // O lembrete do retorno é substituído pelo do agendamento.
    expect(await db.reminder.count({ where: { returnId, status: "PENDING" } })).toBe(0);
    expect(await db.reminder.count({ where: { appointmentId: appointment.id, status: "PENDING" } })).toBe(1);

    // Retorno agendado é resolvido pela agenda, não manualmente.
    await expect(resolveReturn(db, team.asReception, returnId, { status: "COMPLETED" }, CLOCK)).rejects.toThrow(/pelo agendamento/);

    await changeAppointmentStatus(db, team.asReception, appointment.id, { status: "COMPLETED" }, clockAt("2026-11-10T15:40:00-03:00"));
    stored = await db.patientReturn.findUniqueOrThrow({ where: { id: returnId } });
    expect(stored.status).toBe("COMPLETED");
  });

  it("cancelar o agendamento devolve o retorno para pendente", async () => {
    const team = await createTeam(db);
    const patient = await createTestPatient(db);
    const { id: returnId } = await createReturn(
      db,
      team.asReception,
      patient.id,
      returnCreateSchema.parse({ title: "Revisão", dueDate: "2026-11-10" }),
      CLOCK,
    );
    const appointment = await createAppointment(
      db,
      team.asReception,
      appointmentCreateSchema.parse({
        subject: "patient",
        patientId: patient.id,
        professionalId: team.professional.id,
        date: "2026-11-10",
        startTime: "15:00",
        durationMinutes: 30,
        returnId,
      }),
      CLOCK,
    );
    await changeAppointmentStatus(db, team.asReception, appointment.id, { status: "CANCELLED", reason: "Imprevisto" }, CLOCK);
    expect(await db.patientReturn.findUniqueOrThrow({ where: { id: returnId } })).toMatchObject({ status: "PENDING", appointmentId: null });
  });

  it("não vincula retorno de outro paciente", async () => {
    const team = await createTeam(db);
    const patient = await createTestPatient(db);
    const other = await createTestPatient(db);
    const { id: returnId } = await createReturn(
      db,
      team.asReception,
      other.id,
      returnCreateSchema.parse({ title: "Revisão", dueDate: "2026-11-10" }),
      CLOCK,
    );
    await expect(
      createAppointment(
        db,
        team.asReception,
        appointmentCreateSchema.parse({
          subject: "patient",
          patientId: patient.id,
          professionalId: team.professional.id,
          date: "2026-11-10",
          startTime: "15:00",
          durationMinutes: 30,
          returnId,
        }),
        CLOCK,
      ),
    ).rejects.toThrow(/não pertence/);
    expect(await db.appointment.count()).toBe(0);
  });
});
