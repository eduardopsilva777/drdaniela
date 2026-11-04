import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { interactionInputSchema, leadConvertSchema, leadInputSchema } from "@/lib/validation/leads";
import { AuthorizationError } from "@/server/auth/errors";
import { DomainError } from "@/server/errors";
import {
  addLeadInteraction,
  changeLeadStatus,
  convertLeadToPatient,
  createLead,
  deleteLead,
  higherStage,
  updateLead,
} from "@/server/services/leads";

import { CLOCK, createTeam, createTestDb, createTestPatient, resetDatabase } from "./helpers";

const db = createTestDb();

beforeEach(() => resetDatabase(db));
afterAll(() => db.$disconnect());

function leadInput(overrides: Record<string, unknown> = {}) {
  return leadInputSchema.parse({
    name: "Maria Demo",
    phone: "(11) 98765-4321",
    source: "INSTAGRAM",
    ...overrides,
  });
}

async function expectDomainError(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error).toBeInstanceOf(DomainError);
  expect((error as DomainError).code).toBe(code);
  return error as DomainError;
}

describe("cadastro de leads", () => {
  it("normaliza o telefone, registra a criação na linha do tempo e na auditoria", async () => {
    const team = await createTeam(db);
    const lead = await createLead(db, team.asReception, leadInput({ whatsappOptIn: "on" }), CLOCK);

    expect(lead.phone).toBe("+5511987654321");
    expect(lead.status).toBe("NEW");
    expect(lead.whatsappOptInAt).toEqual(CLOCK.now);

    const interactions = await db.interaction.findMany({ where: { leadId: lead.id } });
    expect(interactions).toHaveLength(1);
    expect(interactions[0]).toMatchObject({ type: "SYSTEM", authorId: team.reception.id });

    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "lead.create" } });
    expect(audit).toMatchObject({ entityId: lead.id, actorId: team.reception.id });
  });

  it("impede lead duplicado pelo telefone, mesmo digitado em outro formato", async () => {
    const team = await createTeam(db);
    const first = await createLead(db, team.asReception, leadInput(), CLOCK);

    const error = await expectDomainError(
      createLead(db, team.asReception, leadInput({ name: "Outra Pessoa", phone: "+55 11 98765 4321" }), CLOCK),
      "duplicate_lead",
    );
    expect(error.meta).toEqual({ existingLeadId: first.id });
    expect(error.fieldErrors?.phone?.[0]).toMatch(/Já existe um lead/);
  });

  it("não cria lead com o telefone de um paciente", async () => {
    const team = await createTeam(db);
    const patient = await createTestPatient(db, { phone: "+5511987654321" });
    const error = await expectDomainError(createLead(db, team.asReception, leadInput(), CLOCK), "phone_belongs_to_patient");
    expect(error.meta).toEqual({ existingPatientId: patient.id });
  });

  it("guarda a próxima ação no fuso da clínica", async () => {
    const team = await createTeam(db);
    const lead = await createLead(
      db,
      team.asReception,
      leadInput({ nextActionDate: "2026-11-05", nextActionTime: "14:30", nextActionNote: "Ligar" }),
      CLOCK,
    );
    expect(lead.nextActionAt?.toISOString()).toBe("2026-11-05T17:30:00.000Z");
  });

  it("edita dados e audita apenas os nomes dos campos alterados", async () => {
    const team = await createTeam(db);
    const lead = await createLead(db, team.asReception, leadInput(), CLOCK);
    await updateLead(db, team.asReception, lead.id, leadInput({ priority: "HIGH", interest: "Valores" }), CLOCK);

    const updated = await db.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(updated).toMatchObject({ priority: "HIGH", interest: "Valores" });
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "lead.update" } });
    expect(audit.metadata).toEqual({ fields: "interest,priority" });
  });

  it("não deixa a edição usar o telefone de outro lead", async () => {
    const team = await createTeam(db);
    await createLead(db, team.asReception, leadInput(), CLOCK);
    const other = await createLead(db, team.asReception, leadInput({ name: "Ana Demo", phone: "11912345678" }), CLOCK);
    await expectDomainError(
      updateLead(db, team.asReception, other.id, leadInput({ name: "Ana Demo" }), CLOCK),
      "duplicate_lead",
    );
  });
});

describe("funil comercial", () => {
  it("registra cada mudança de etapa no histórico e guarda a etapa mais avançada", async () => {
    const team = await createTeam(db);
    const lead = await createLead(db, team.asReception, leadInput(), CLOCK);

    await changeLeadStatus(db, team.asReception, { leadId: lead.id, status: "SCHEDULED" }, CLOCK);
    await changeLeadStatus(db, team.asReception, { leadId: lead.id, status: "IN_PROGRESS" }, CLOCK);

    const stored = await db.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(stored.status).toBe("IN_PROGRESS");
    expect(stored.peakStatus).toBe("SCHEDULED");

    const changes = await db.interaction.findMany({
      where: { leadId: lead.id, type: "STATUS_CHANGE" },
      orderBy: { createdAt: "asc" },
    });
    expect(changes.map((item) => [item.fromStatus, item.toStatus])).toEqual([
      ["NEW", "SCHEDULED"],
      ["SCHEDULED", "IN_PROGRESS"],
    ]);
  });

  it("perda guarda motivo e data; voltar ao funil limpa o motivo", async () => {
    const team = await createTeam(db);
    const lead = await createLead(db, team.asReception, leadInput(), CLOCK);

    await changeLeadStatus(db, team.asReception, { leadId: lead.id, status: "LOST", lostReason: "Preço" }, CLOCK);
    let stored = await db.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(stored).toMatchObject({ status: "LOST", lostReason: "Preço", lostAt: CLOCK.now });

    await changeLeadStatus(db, team.asReception, { leadId: lead.id, status: "IN_PROGRESS" }, CLOCK);
    stored = await db.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(stored).toMatchObject({ status: "IN_PROGRESS", lostReason: null, lostAt: null });
  });

  it("não converte pela mudança de etapa (exige o fluxo de conversão)", async () => {
    const team = await createTeam(db);
    const lead = await createLead(db, team.asReception, leadInput(), CLOCK);
    await expectDomainError(
      changeLeadStatus(db, team.asReception, { leadId: lead.id, status: "CONVERTED" }, CLOCK),
      "use_conversion",
    );
  });

  it("calcula a etapa mais avançada ignorando a perda", () => {
    expect(higherStage("IN_PROGRESS", "LOST")).toBe("IN_PROGRESS");
    expect(higherStage("NEW", "SCHEDULED")).toBe("SCHEDULED");
    expect(higherStage("SCHEDULED", "IN_PROGRESS")).toBe("SCHEDULED");
  });
});

describe("interações", () => {
  it("o primeiro contato move o lead para Em atendimento e substitui a próxima ação", async () => {
    const team = await createTeam(db);
    const lead = await createLead(db, team.asReception, leadInput({ nextActionDate: "2026-11-02" }), CLOCK);

    const input = interactionInputSchema.parse({
      type: "CALL",
      direction: "OUTBOUND",
      content: "Apresentei os valores.",
      nextActionDate: "2026-11-04",
      nextActionTime: "10:00",
      nextActionNote: "Retornar",
    });
    await addLeadInteraction(db, team.asReception, lead.id, input, CLOCK);

    const stored = await db.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(stored.status).toBe("IN_PROGRESS");
    expect(stored.lastContactAt).toEqual(CLOCK.now);
    expect(stored.nextActionAt?.toISOString()).toBe("2026-11-04T13:00:00.000Z");
    expect(stored.nextActionNote).toBe("Retornar");

    const types = await db.interaction.findMany({ where: { leadId: lead.id }, select: { type: true } });
    expect(types.map((item) => item.type).sort()).toEqual(["CALL", "STATUS_CHANGE", "SYSTEM"]);
  });

  it("uma nota não conta como contato nem muda a etapa", async () => {
    const team = await createTeam(db);
    const lead = await createLead(db, team.asReception, leadInput(), CLOCK);
    await addLeadInteraction(
      db,
      team.asReception,
      lead.id,
      interactionInputSchema.parse({ type: "NOTE", content: "Prefere período da tarde." }),
      CLOCK,
    );
    const stored = await db.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(stored.status).toBe("NEW");
    expect(stored.lastContactAt).toBeNull();
  });

  it("recusa interação com data no futuro", async () => {
    const team = await createTeam(db);
    const lead = await createLead(db, team.asReception, leadInput(), CLOCK);
    const input = interactionInputSchema.parse({ type: "CALL", content: "Ligação", occurredDate: "2026-11-10" });
    await expect(addLeadInteraction(db, team.asReception, lead.id, input, CLOCK)).rejects.toThrow(/futuro/);
  });
});

describe("conversão em paciente", () => {
  it("cria o paciente com a origem do lead e leva junto histórico e agendamentos", async () => {
    const team = await createTeam(db);
    const lead = await createLead(db, team.asReception, leadInput({ whatsappOptIn: "on", sourceDetail: "Campanha" }), CLOCK);
    const appointment = await db.appointment.create({
      data: {
        leadId: lead.id,
        professionalId: team.professional.id,
        startsAt: new Date("2026-11-03T13:00:00Z"),
        endsAt: new Date("2026-11-03T14:00:00Z"),
      },
    });

    const result = await convertLeadToPatient(
      db,
      team.asReception,
      lead.id,
      leadConvertSchema.parse({ mode: "create", fullName: "Maria Demo da Silva", whatsappOptIn: "on" }),
      CLOCK,
    );

    const patient = await db.patient.findUniqueOrThrow({ where: { id: result.patientId } });
    expect(patient).toMatchObject({
      fullName: "Maria Demo da Silva",
      phone: lead.phone,
      source: "INSTAGRAM",
      sourceDetail: "Campanha",
      whatsappOptIn: true,
    });

    const stored = await db.lead.findUniqueOrThrow({ where: { id: lead.id } });
    expect(stored).toMatchObject({ status: "CONVERTED", peakStatus: "CONVERTED", patientId: patient.id });

    const unlinked = await db.interaction.count({ where: { leadId: lead.id, patientId: null } });
    expect(unlinked).toBe(0);
    const linkedAppointment = await db.appointment.findUniqueOrThrow({ where: { id: appointment.id } });
    expect(linkedAppointment.patientId).toBe(patient.id);

    // O paciente autorizou o WhatsApp: o horário futuro ganha lembrete.
    const reminders = await db.reminder.findMany({ where: { appointmentId: appointment.id } });
    expect(reminders).toHaveLength(1);
  });

  it("é transacional e impede converter duas vezes", async () => {
    const team = await createTeam(db);
    const lead = await createLead(db, team.asReception, leadInput(), CLOCK);
    const input = leadConvertSchema.parse({ mode: "create", fullName: "Maria Demo" });

    const results = await Promise.allSettled([
      convertLeadToPatient(db, team.asReception, lead.id, input, CLOCK),
      convertLeadToPatient(db, team.asReception, lead.id, input, CLOCK),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await db.patient.count()).toBe(1);
  });

  it("pede confirmação quando já existe paciente com o telefone, e permite vincular", async () => {
    const team = await createTeam(db);
    const lead = await createLead(db, team.asReception, leadInput(), CLOCK);
    // Paciente cadastrado depois do lead, com o mesmo telefone.
    const patient = await createTestPatient(db, { phone: lead.phone, fullName: "Maria Demo" });

    await expectDomainError(
      convertLeadToPatient(db, team.asReception, lead.id, leadConvertSchema.parse({ mode: "create", fullName: "Maria" }), CLOCK),
      "patient_phone_exists",
    );

    const result = await convertLeadToPatient(
      db,
      team.asReception,
      lead.id,
      leadConvertSchema.parse({ mode: "link", existingPatientId: patient.id, fullName: "Maria Demo" }),
      CLOCK,
    );
    expect(result.patientId).toBe(patient.id);
    expect(await db.patient.count()).toBe(1);
  });
});

describe("exclusão de leads", () => {
  it("exige permissão de exclusão", async () => {
    const team = await createTeam(db);
    const lead = await createLead(db, team.asReception, leadInput(), CLOCK);
    await expect(deleteLead(db, team.asReception, lead.id)).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("apaga o lead e as interações; preserva leads convertidos ou com agendamentos", async () => {
    const team = await createTeam(db);
    const lead = await createLead(db, team.asReception, leadInput(), CLOCK);
    await deleteLead(db, team.asProfessional, lead.id);
    expect(await db.lead.count()).toBe(0);
    expect(await db.interaction.count()).toBe(0);
    expect(await db.auditLog.count({ where: { action: "lead.delete" } })).toBe(1);

    const withAppointment = await createLead(db, team.asReception, leadInput(), CLOCK);
    await db.appointment.create({
      data: {
        leadId: withAppointment.id,
        professionalId: team.professional.id,
        startsAt: new Date("2026-11-03T13:00:00Z"),
        endsAt: new Date("2026-11-03T14:00:00Z"),
      },
    });
    await expect(deleteLead(db, team.asProfessional, withAppointment.id)).rejects.toThrow(/agendamentos/);
  });
});
