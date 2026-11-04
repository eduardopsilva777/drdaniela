import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_ASSISTANT_CONFIG } from "@/lib/assistant-config";
import { appointmentCreateSchema } from "@/lib/validation/appointments";
import { knowledgeEntryInputSchema } from "@/lib/validation/assistant";
import { applyProtocolSchema, protocolInputSchema } from "@/lib/validation/care";
import { leadConvertSchema, leadInputSchema } from "@/lib/validation/leads";
import { RulesAssistantModel } from "@/server/assistant/rules-model";
import { AuthorizationError } from "@/server/auth/errors";
import { getContentKeyring } from "@/server/crypto/content-key";
import { DomainError } from "@/server/errors";
import { createAppointment } from "@/server/services/appointments";
import { processAssistantQueue } from "@/server/services/assistant";
import { applyProtocolToPatient, createProtocol, updateProtocol } from "@/server/services/care-plan";
import {
  approveKnowledgeVersion,
  createKnowledgeEntry,
  createKnowledgeVersion,
  loadPublishedPassages,
  readGapQuestion,
  rejectKnowledgeVersion,
  reportAssistantReply,
  setKnowledgeEntryArchived,
} from "@/server/services/knowledge";
import { testKnowledgeQuestion } from "@/server/services/knowledge-test";
import { convertLeadToPatient, createLead } from "@/server/services/leads";
import {
  cancelReturnSequence,
  nextAllowedSendTime,
  processReminderQueue,
  resumeReturnSequence,
  type QueueDependencies,
} from "@/server/services/reminders";
import { syncTemplatesFromMeta } from "@/server/services/templates";
import { processWebhookPayload, recordInboundMessage } from "@/server/services/whatsapp";
import type { WhatsAppProvider } from "@/server/whatsapp/types";
import { webhookPayloadSchema } from "@/server/whatsapp/webhook";

import { CLOCK, createTeam, createTestDb, createTestPatient, createTestProcedure, NOW, resetDatabase, TZ, uniquePhone } from "./helpers";

const db = createTestDb();
const keyring = getContentKeyring();

beforeEach(() => resetDatabase(db));
afterAll(() => db.$disconnect());

type Team = Awaited<ReturnType<typeof createTeam>>;

function entryInput(overrides: Record<string, unknown> = {}) {
  return knowledgeEntryInputSchema.parse({
    category: "CLINIC_INFO",
    title: "Qual o horário de atendimento?",
    content: "Atendemos de segunda a sexta, das 9h às 18h.",
    keywords: "horário, funcionamento",
    ...overrides,
  });
}

describe("base de conhecimento com versões e aprovação", () => {
  it("rascunho não chega ao assistente; só a versão aprovada é usada; recusa e arquivamento", async () => {
    const team = await createTeam(db);
    const { entryId, versionId } = await createKnowledgeEntry(db, team.asReception, entryInput());
    expect(await loadPublishedPassages(db)).toEqual([]);

    await expect(approveKnowledgeVersion(db, team.asReception, versionId)).rejects.toBeInstanceOf(AuthorizationError);
    await approveKnowledgeVersion(db, team.asProfessional, versionId, "Conferido com a agenda.");
    expect((await loadPublishedPassages(db)).map((passage) => passage.content)).toEqual(["Atendemos de segunda a sexta, das 9h às 18h."]);

    const second = await createKnowledgeVersion(db, team.asReception, entryId, entryInput({ content: "Atendemos de segunda a sábado, das 9h às 18h.", submit: "on" }));
    expect((await loadPublishedPassages(db))[0]!.content).toContain("segunda a sexta");

    await approveKnowledgeVersion(db, team.asAdmin, second.versionId);
    expect((await loadPublishedPassages(db))[0]!.content).toContain("segunda a sábado");
    const versions = await db.knowledgeEntryVersion.findMany({ where: { entryId }, orderBy: { version: "asc" } });
    expect(versions.map((version) => [version.version, version.status, version.authorId])).toEqual([
      [1, "SUPERSEDED", team.reception.id],
      [2, "APPROVED", team.reception.id],
    ]);
    expect(versions[1]).toMatchObject({ reviewedById: team.admin.id });

    const third = await createKnowledgeVersion(db, team.asReception, entryId, entryInput({ content: "Texto errado." }));
    await rejectKnowledgeVersion(db, team.asProfessional, third.versionId, "Horário não confere.");
    expect((await loadPublishedPassages(db))[0]!.content).toContain("segunda a sábado");

    await setKnowledgeEntryArchived(db, team.asProfessional, entryId, true);
    expect(await loadPublishedPassages(db)).toEqual([]);
    await setKnowledgeEntryArchived(db, team.asProfessional, entryId, false);
    expect(await loadPublishedPassages(db)).toHaveLength(1);
    expect(await db.auditLog.count({ where: { action: "knowledge.version.approve" } })).toBe(2);
  });

  it("pergunta sem resposta vira pendência mascarada e é resolvida quando a resposta é aprovada", async () => {
    const team = await createTeam(db);
    const provider: WhatsAppProvider = {
      name: "cloud_api",
      sendText: async () => ({ providerMessageId: `wamid.${Math.random()}`, status: "SENT" }),
      sendTemplate: async () => ({ providerMessageId: `wamid.${Math.random()}`, status: "SENT" }),
    };
    await recordInboundMessage(
      db,
      { kind: "message", providerMessageId: "wamid.q1", from: uniquePhone().slice(1), contactName: null, receivedAt: NOW, type: "text", body: "vocês atendem aos domingos? meu número é 11987654321" },
      "cloud_api",
    );
    await processAssistantQueue(db, { provider, model: new RulesAssistantModel(), timeZone: TZ, keyring, reminderSettings: CLOCK.reminders! }, { now: NOW });

    const gap = await db.knowledgeGap.findFirstOrThrow();
    expect(gap).toMatchObject({ reason: "NO_ANSWER", status: "OPEN" });
    const question = readGapQuestion(gap.question, keyring);
    expect(question).toContain("domingos");
    expect(question).not.toContain("11987654321");
    if (keyring) expect(gap.question).not.toContain("domingos");

    const { versionId } = await createKnowledgeEntry(db, team.asReception, entryInput({ title: "Vocês atendem aos domingos?", content: "Não atendemos aos domingos.", gapId: gap.id, submit: "on" }));
    expect((await db.knowledgeGap.findUniqueOrThrow({ where: { id: gap.id } })).status).toBe("OPEN");
    await approveKnowledgeVersion(db, team.asProfessional, versionId);
    expect(await db.knowledgeGap.findUniqueOrThrow({ where: { id: gap.id } })).toMatchObject({ status: "RESOLVED", resolvedById: team.professional.id });
  });

  it("avaliação negativa de uma resposta do assistente gera uma única pendência", async () => {
    const team = await createTeam(db);
    const { versionId } = await createKnowledgeEntry(db, team.asReception, entryInput({ submit: "on" }));
    await approveKnowledgeVersion(db, team.asProfessional, versionId);
    const provider: WhatsAppProvider = {
      name: "development",
      sendText: async () => ({ providerMessageId: `dev-${Math.random()}`, status: "SIMULATED" }),
      sendTemplate: async () => ({ providerMessageId: `dev-${Math.random()}`, status: "SIMULATED" }),
    };
    const { conversationId } = await recordInboundMessage(
      db,
      { kind: "message", providerMessageId: "wamid.q2", from: uniquePhone().slice(1), contactName: null, receivedAt: NOW, type: "text", body: "qual o horário de atendimento?" },
      "development",
    );
    await processAssistantQueue(db, { provider, model: new RulesAssistantModel(), timeZone: TZ, keyring, reminderSettings: CLOCK.reminders! }, { now: NOW });
    const reply = await db.whatsAppMessage.findFirstOrThrow({ where: { conversationId, origin: "ASSISTANT" } });

    expect(await reportAssistantReply(db, team.asReception, keyring, reply.id, "Horário mudou")).toEqual({ created: true });
    expect(await reportAssistantReply(db, team.asReception, keyring, reply.id)).toEqual({ created: false });
    const gap = await db.knowledgeGap.findFirstOrThrow();
    expect(gap).toMatchObject({ reason: "NEGATIVE_FEEDBACK", messageId: reply.id, reportedById: team.reception.id });
    expect(readGapQuestion(gap.question, keyring)).toBe("qual o horário de atendimento?");

    const inbound = await db.whatsAppMessage.findFirstOrThrow({ where: { conversationId, origin: "CONTACT" } });
    await expect(reportAssistantReply(db, team.asReception, keyring, inbound.id)).rejects.toBeInstanceOf(DomainError);
  });

  it("teste antes de publicar: rascunhos só entram quando pedido", async () => {
    const team = await createTeam(db);
    await createKnowledgeEntry(db, team.asReception, entryInput());
    const options = { timeZone: TZ, now: NOW };
    const published = await testKnowledgeQuestion(db, team.asReception, new RulesAssistantModel(), { question: "qual o horário de atendimento?", includeDrafts: false }, options);
    expect(published.answer).toBeNull();
    const withDrafts = await testKnowledgeQuestion(db, team.asReception, new RulesAssistantModel(), { question: "qual o horário de atendimento?", includeDrafts: true }, options);
    expect(withDrafts.answer).toContain("segunda a sexta");
    expect(await db.whatsAppMessage.count()).toBe(0);
    expect(await db.auditLog.count({ where: { action: "assistant.test" } })).toBe(2);
  });
});

// -----------------------------------------------------------------------------
// Sequências de acompanhamento de protocolos
// -----------------------------------------------------------------------------

class TemplateProvider implements WhatsAppProvider {
  readonly name = "cloud_api" as const;
  readonly templates: Array<{ to: string; templateName: string; bodyParameters: string[] }> = [];
  async sendText() {
    return { providerMessageId: `wamid.${Math.random()}`, status: "SENT" as const };
  }
  async sendTemplate(message: { to: string; templateName: string; language: string; bodyParameters: string[] }) {
    this.templates.push(message);
    return { providerMessageId: `wamid.tpl.${this.templates.length}`, status: "SENT" as const };
  }
}

const ALL_DAY = { ...DEFAULT_ASSISTANT_CONFIG.proactive, allowedWeekdays: [0, 1, 2, 3, 4, 5, 6], startTime: "00:00", endTime: "23:59" };

function queueDeps(provider: WhatsAppProvider | null, proactive = ALL_DAY): QueueDependencies {
  return { provider, timeZone: TZ, language: "pt_BR", templates: {}, proactive, clinicName: "Clínica Teste" };
}

async function followUpFixture(team: Team, templateStatus: "APPROVED" | "PENDING" = "APPROVED") {
  const procedure = await createTestProcedure(db, { name: "Bioestimulador Demo" });
  const template = await db.messageTemplate.create({
    data: {
      name: "acompanhamento_retorno",
      category: "UTILITY",
      usage: "FOLLOW_UP",
      body: "Olá, {{1}}! Seu retorno de {{2}} está previsto para {{3}}. Quer agendar uma avaliação?",
      parameters: ["patient_name", "procedure_name", "due_date"],
      status: templateStatus,
    },
  });
  const protocol = await createProtocol(
    db,
    team.asProfessional,
    protocolInputSchema.parse({
      name: "Protocolo com acompanhamento",
      procedureId: procedure.id,
      durationDays: 180,
      steps: [
        { label: "Sessão 2", kind: "SESSION", offsetDays: 30, relativeTo: "START" },
        { label: "Manutenção", kind: "MAINTENANCE", offsetDays: 60, relativeTo: "START" },
      ],
      followUpRules: [
        { daysBefore: 14, action: "MESSAGE", templateId: template.id },
        { daysBefore: 3, action: "MESSAGE", templateId: template.id, stepKinds: ["MAINTENANCE"] },
        { daysBefore: 0, action: "TASK", taskTitle: "Ligar se ainda não agendou" },
      ],
    }),
  );
  return { procedure, template, protocol };
}

async function applyTo(team: Team, protocolId: string, patientId: string) {
  await applyProtocolToPatient(
    db,
    team.asProfessional,
    patientId,
    applyProtocolSchema.parse({ protocolId, startDate: "2026-11-02", registerInitialProcedure: "" }),
    CLOCK,
  );
}

function schedule(reminders: Array<{ channel: string; scheduledFor: Date; return: { title: string } | null }>) {
  return reminders
    .map((item) => `${item.return?.title} ${item.channel} ${item.scheduledFor.toISOString().slice(0, 10)}`)
    .sort();
}

describe("acompanhamento de protocolos", () => {
  it("cada regra gera sua etapa: mensagem para quem autorizou, tarefa para quem não autorizou", async () => {
    const team = await createTeam(db);
    const { protocol } = await followUpFixture(team);
    const consenting = await createTestPatient(db, { whatsappOptIn: true });
    const notConsenting = await createTestPatient(db, { whatsappOptIn: false });
    await applyTo(team, protocol.id, consenting.id);
    await applyTo(team, protocol.id, notConsenting.id);

    const withConsent = await db.reminder.findMany({ where: { patientId: consenting.id }, include: { return: { select: { title: true } } } });
    expect(schedule(withConsent)).toEqual([
      "Manutenção TASK 2027-01-01",
      "Manutenção WHATSAPP 2026-12-18",
      "Manutenção WHATSAPP 2026-12-29",
      "Sessão 2 TASK 2026-12-02",
      "Sessão 2 WHATSAPP 2026-11-18",
    ]);
    const withoutConsent = await db.reminder.findMany({ where: { patientId: notConsenting.id }, include: { return: { select: { title: true } } } });
    expect(new Set(withoutConsent.map((item) => item.channel))).toEqual(new Set(["TASK"]));
    expect(withoutConsent).toHaveLength(5);
  });

  it("envia com o modelo aprovado (origem acompanhamento) e cria a tarefa da equipe sem duplicar", async () => {
    const team = await createTeam(db);
    const { protocol } = await followUpFixture(team);
    const patient = await createTestPatient(db, { fullName: "Joana Acompanhamento", whatsappOptIn: true });
    await applyTo(team, protocol.id, patient.id);
    const provider = new TemplateProvider();

    const at = new Date("2026-11-18T12:30:00Z");
    expect(await processReminderQueue(db, queueDeps(provider), { now: at })).toMatchObject({ claimed: 1, sent: 1 });
    expect(provider.templates[0]).toMatchObject({ templateName: "acompanhamento_retorno", bodyParameters: ["Joana", "Bioestimulador Demo", "02/12"] });
    const message = await db.whatsAppMessage.findFirstOrThrow({ where: { direction: "OUTBOUND" } });
    expect(message).toMatchObject({ origin: "FOLLOW_UP", type: "TEMPLATE", templateName: "acompanhamento_retorno" });

    const taskDay = new Date("2026-12-02T12:30:00Z");
    expect(await processReminderQueue(db, queueDeps(provider), { now: taskDay })).toMatchObject({ claimed: 1, tasks: 1 });
    const task = await db.staffTask.findFirstOrThrow();
    expect(task).toMatchObject({ kind: "FOLLOW_UP", patientId: patient.id, status: "OPEN" });
    expect(task.title).toContain("Ligar se ainda não agendou — Joana");
    expect(await processReminderQueue(db, queueDeps(provider), { now: taskDay })).toMatchObject({ claimed: 0 });
    expect(await db.staffTask.count()).toBe(1);
  });

  it("modelo ainda não aprovado: falha definitiva e aviso para a equipe; sem WhatsApp, só as tarefas seguem", async () => {
    const team = await createTeam(db);
    const { protocol } = await followUpFixture(team, "PENDING");
    const patient = await createTestPatient(db, { whatsappOptIn: true });
    await applyTo(team, protocol.id, patient.id);

    const at = new Date("2026-11-18T12:30:00Z");
    expect(await processReminderQueue(db, queueDeps(null), { now: at })).toMatchObject({ claimed: 0 });
    await processReminderQueue(db, queueDeps(new TemplateProvider()), { now: at });
    const failed = await db.reminder.findFirstOrThrow({ where: { status: "FAILED" } });
    expect(failed.lastError).toContain("não está aprovado");
    expect(await db.staffTask.findFirstOrThrow()).toMatchObject({ kind: "AUTOMATION_FAILURE" });
  });

  it("respeita o horário permitido e o limite de mensagens por contato", async () => {
    const team = await createTeam(db);
    const { protocol } = await followUpFixture(team);
    const patient = await createTestPatient(db, { whatsappOptIn: true });
    await applyTo(team, protocol.id, patient.id);
    const proactive = { ...DEFAULT_ASSISTANT_CONFIG.proactive, maxPerDay: 1 };

    // 22h de quarta-feira: fora do horário — adiado para 8h do dia seguinte.
    const night = new Date("2026-11-19T01:00:00Z");
    expect(await processReminderQueue(db, queueDeps(new TemplateProvider(), proactive), { now: night })).toMatchObject({ deferred: 1, sent: 0 });
    const deferred = await db.reminder.findFirstOrThrow({ where: { channel: "WHATSAPP", status: "PENDING" }, orderBy: { scheduledFor: "asc" } });
    expect(deferred.scheduledFor).toEqual(nextAllowedSendTime(night, TZ, proactive));
    expect(deferred.scheduledFor.toISOString()).toBe("2026-11-19T11:00:00.000Z");

    // Já houve uma mensagem proativa hoje para o número: a próxima espera o dia seguinte.
    const conversation = await db.whatsAppConversation.create({ data: { contactPhone: patient.phone } });
    await db.whatsAppMessage.create({
      data: { conversationId: conversation.id, direction: "OUTBOUND", origin: "REMINDER", provider: "cloud_api", status: "SENT", createdAt: new Date("2026-11-19T11:30:00Z") },
    });
    const morning = new Date("2026-11-19T12:00:00Z");
    expect(await processReminderQueue(db, queueDeps(new TemplateProvider(), proactive), { now: morning })).toMatchObject({ deferred: 1, sent: 0 });
  });

  it("resposta do paciente pausa a sequência; a equipe retoma só a etapa vencida mais recente ou encerra", async () => {
    const team = await createTeam(db);
    const { protocol } = await followUpFixture(team);
    const patient = await createTestPatient(db, { whatsappOptIn: true });
    await applyTo(team, protocol.id, patient.id);

    await recordInboundMessage(
      db,
      { kind: "message", providerMessageId: "wamid.reply", from: patient.phone.slice(1), contactName: null, receivedAt: NOW, type: "text", body: "Oi, quero saber do retorno" },
      "cloud_api",
    );
    const paused = await db.reminder.findMany({ where: { patientId: patient.id } });
    expect(paused.every((item) => item.status === "PAUSED")).toBe(true);

    const maintenance = await db.patientReturn.findFirstOrThrow({ where: { patientId: patient.id, title: "Manutenção" } });
    const later = new Date("2026-12-30T12:00:00Z");
    await resumeReturnSequence(db, team.asReception, maintenance.id, later);
    const after = await db.reminder.findMany({ where: { returnId: maintenance.id }, orderBy: { scheduledFor: "asc" } });
    expect(after.map((item) => item.status).sort()).toEqual(["CANCELLED", "PENDING", "PENDING"]);
    expect(after.find((item) => item.scheduledFor.getTime() === later.getTime())?.status).toBe("PENDING");

    await cancelReturnSequence(db, team.asReception, maintenance.id, later);
    expect(await db.reminder.count({ where: { returnId: maintenance.id, status: { in: ["PENDING", "PAUSED"] } } })).toBe(0);
    expect(await db.auditLog.count({ where: { action: { in: ["follow_up.resume", "follow_up.cancel"] } } })).toBe(2);
  });

  it("remover uma regra do protocolo cancela as etapas pendentes dela", async () => {
    const team = await createTeam(db);
    const { protocol, procedure } = await followUpFixture(team);
    const patient = await createTestPatient(db, { whatsappOptIn: true });
    await applyTo(team, protocol.id, patient.id);

    await updateProtocol(
      db,
      team.asProfessional,
      protocol.id,
      protocolInputSchema.parse({
        name: "Protocolo com acompanhamento",
        procedureId: procedure.id,
        steps: [
          { label: "Sessão 2", kind: "SESSION", offsetDays: 30, relativeTo: "START" },
          { label: "Manutenção", kind: "MAINTENANCE", offsetDays: 60, relativeTo: "START" },
        ],
        followUpRules: [{ daysBefore: 0, action: "TASK", taskTitle: "Ligar se ainda não agendou" }],
      }),
    );
    expect(await db.followUpRule.count()).toBe(1);
    expect(await db.reminder.count({ where: { channel: "WHATSAPP", status: "PENDING" } })).toBe(0);
    expect(await db.reminder.count({ where: { channel: "TASK", status: "PENDING" } })).toBe(2);
  });
});

describe("lembretes de leads e modelos da Meta", () => {
  it("lead que autorizou tem lembrete da avaliação; na conversão, o lembrete passa para o paciente", async () => {
    const team = await createTeam(db);
    const procedure = await createTestProcedure(db, { name: "Avaliação" });
    const lead = await createLead(
      db,
      team.asReception,
      leadInputSchema.parse({ name: "Lead Lembrete", phone: uniquePhone(), source: "WHATSAPP", whatsappOptIn: "on" }),
      CLOCK,
    );
    expect(await db.consentEvent.findFirstOrThrow()).toMatchObject({ source: "STAFF", granted: true, leadId: lead.id });
    const appointment = await createAppointment(
      db,
      team.asReception,
      appointmentCreateSchema.parse({
        subject: "lead",
        leadId: lead.id,
        professionalId: team.professional.id,
        procedureId: procedure.id,
        date: "2026-11-05",
        startTime: "10:00",
        durationMinutes: 30,
      }),
      CLOCK,
    );
    expect(await db.reminder.findFirstOrThrow({ where: { status: "PENDING" } })).toMatchObject({ leadId: lead.id, patientId: null, appointmentId: appointment.id });

    await convertLeadToPatient(db, team.asReception, lead.id, leadConvertSchema.parse({ mode: "create", fullName: "Lead Lembrete Paciente", whatsappOptIn: "on" }), CLOCK);
    const active = await db.reminder.findFirstOrThrow({ where: { status: "PENDING" } });
    expect(active.patientId).not.toBeNull();
    expect(await db.reminder.count({ where: { leadId: lead.id, status: "CANCELLED" } })).toBe(1);
  });

  it("situação dos modelos: webhook da Meta e sincronização atualizam só os cadastrados", async () => {
    const team = await createTeam(db);
    await db.messageTemplate.create({
      data: { name: "lembrete_retorno", category: "UTILITY", usage: "RETURN_REMINDER", body: "Olá, {{1}}!", parameters: ["patient_name"], status: "PENDING" },
    });
    const payload = webhookPayloadSchema.parse({
      object: "whatsapp_business_account",
      entry: [
        {
          id: "WABA",
          time: 1_790_000_000,
          changes: [
            { field: "message_template_status_update", value: { event: "REJECTED", message_template_name: "lembrete_retorno", message_template_language: "pt_BR", reason: "INVALID_FORMAT" } },
          ],
        },
      ],
    });
    expect(await processWebhookPayload(db, payload)).toMatchObject({ processed: 1 });
    expect(await db.messageTemplate.findFirstOrThrow()).toMatchObject({ status: "REJECTED", statusSource: "meta", rejectionReason: "INVALID_FORMAT" });

    const fetchImpl = (async () =>
      Response.json({
        data: [
          { name: "lembrete_retorno", language: "pt_BR", status: "APPROVED", id: "999" },
          { name: "modelo_nao_cadastrado", language: "pt_BR", status: "APPROVED", id: "1000" },
        ],
      })) as typeof fetch;
    const result = await syncTemplatesFromMeta(db, team.asAdmin, { graphApiVersion: "v23.0", businessAccountId: "123456", accessToken: "token-de-teste-123456789", fetchImpl });
    expect(result).toEqual({ received: 2, updated: 1 });
    expect(await db.messageTemplate.findFirstOrThrow()).toMatchObject({ status: "APPROVED", metaTemplateId: "999", rejectionReason: null });
    expect(await db.messageTemplate.count()).toBe(1);

    const denied = (async () => new Response("{}", { status: 401 })) as typeof fetch;
    await expect(syncTemplatesFromMeta(db, team.asAdmin, { graphApiVersion: "v23.0", businessAccountId: "123456", accessToken: "x".repeat(20), fetchImpl: denied })).rejects.toThrow(/credencial/);
    await expect(syncTemplatesFromMeta(db, team.asReception, { graphApiVersion: "v23.0", businessAccountId: "1", accessToken: "x".repeat(20), fetchImpl })).rejects.toBeInstanceOf(AuthorizationError);
  });
});
