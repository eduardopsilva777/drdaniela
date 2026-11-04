import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_ASSISTANT_CONFIG, type AssistantConfig } from "@/lib/assistant-config";
import { knowledgeEntryInputSchema } from "@/lib/validation/assistant";
import { returnCreateSchema } from "@/lib/validation/care";
import { RulesAssistantModel } from "@/server/assistant/rules-model";
import { isSealed, memoryContext, messageContext, openText } from "@/server/crypto/content-cipher";
import type { Keyring } from "@/server/crypto/field-encryption";
import { processAssistantQueue, type AssistantDependencies } from "@/server/services/assistant";
import { ASSISTANT_USER_ID } from "@/server/services/assistant-actor";
import { createReturn } from "@/server/services/care-plan";
import { scheduleFollowUps } from "@/server/services/follow-ups";
import { approveKnowledgeVersion, createKnowledgeEntry } from "@/server/services/knowledge";
import { addPatientNote } from "@/server/services/patients";
import { completeTask } from "@/server/services/tasks";
import { recordInboundMessage } from "@/server/services/whatsapp";
import type { WhatsAppProvider } from "@/server/whatsapp/types";

import { finalReply, ScriptedAgentModel, testRuntime, toolCall } from "../support/scripted-agent-model";

import { CLOCK, createTeam, createTestDb, createTestPatient, createTestProcedure, NOW, resetDatabase, testEncryptionKey, TZ, uniquePhone } from "./helpers";

/**
 * IA generativa de ponta a ponta: webhook → fila → agente (provedor
 * roteirizado, sem rede) → ferramentas do CRM no PostgreSQL real → resposta
 * pelo WhatsApp simulado. Verifica efeitos no banco, não só o texto.
 */

const db = createTestDb();
const keyring: Keyring = { current: testEncryptionKey(), previous: [] };

beforeEach(() => resetDatabase(db));
afterAll(() => db.$disconnect());

const at = (minutesFromNow: number) => new Date(NOW.getTime() + minutesFromNow * 60_000);

class RecordingProvider implements WhatsAppProvider {
  readonly name = "cloud_api" as const;
  readonly sent: Array<{ to: string; body: string }> = [];
  async sendText(message: { to: string; body: string }) {
    this.sent.push(message);
    return { providerMessageId: `wamid.out.${this.sent.length}.${Math.random()}`, status: "SENT" as const };
  }
  async sendTemplate() {
    return { providerMessageId: `wamid.tpl.${Math.random()}`, status: "SENT" as const };
  }
}

function dependencies(provider: WhatsAppProvider | null, model: ScriptedAgentModel): AssistantDependencies {
  return {
    provider,
    model: new RulesAssistantModel(),
    agent: testRuntime(model),
    timeZone: TZ,
    keyring,
    reminderSettings: CLOCK.reminders!,
  };
}

let sequence = 0;
async function receive(phone: string, text: string, when: Date) {
  sequence += 1;
  const result = await recordInboundMessage(
    db,
    { kind: "message", providerMessageId: `wamid.agent.${sequence}`, from: phone.slice(1), contactName: "Contato", receivedAt: when, type: "text", body: text },
    "cloud_api",
    keyring,
  );
  if (result.duplicate) throw new Error("reentrega inesperada");
  return result;
}

async function outbound(conversationId: string) {
  const messages = await db.whatsAppMessage.findMany({ where: { conversationId, direction: "OUTBOUND" }, orderBy: { createdAt: "asc" } });
  return messages.map((message) => ({ ...message, text: openText(message.body, messageContext(conversationId), keyring) ?? "" }));
}

async function configure(overrides: Partial<AssistantConfig> = {}) {
  const config = { ...DEFAULT_ASSISTANT_CONFIG, ...overrides };
  await db.assistantSettings.upsert({ where: { id: "default" }, create: { id: "default", config }, update: { config } });
  return config;
}

async function setupClinic() {
  const team = await createTeam(db);
  const evaluation = await createTestProcedure(db, { name: "Avaliação", durationMinutes: 60 });
  const { versionId, entryId } = await createKnowledgeEntry(
    db,
    team.asReception,
    knowledgeEntryInputSchema.parse({
      category: "PRICING",
      title: "Valor do botox",
      content: "A aplicação de toxina botulínica (botox) custa R$ 1.200,00, em até 3x no cartão.",
      keywords: "botox, toxina, preço, valor",
      submit: "on",
    }),
  );
  await approveKnowledgeVersion(db, team.asProfessional, versionId);
  await configure({
    booking: { ...DEFAULT_ASSISTANT_CONFIG.booking, enabled: true, procedureId: evaluation.id, professionalIds: [team.professional.id] },
  });
  return { team, evaluation, entryId };
}

/** Texto do contexto que o modelo recebeu no primeiro pedido de cada turno. */
function contextOf(model: ScriptedAgentModel, index: number): string {
  const block = model.requests[index]!.messages[0]!.content[0]!;
  return block.type === "text" ? block.text : "";
}

describe("IA conversacional ponta a ponta", () => {
  it("lead novo: tira dúvida com a base, cadastra, agenda com confirmação explícita e registra o consentimento", async () => {
    const { team, entryId } = await setupClinic();
    const provider = new RecordingProvider();
    const phone = uniquePhone();
    const model = new ScriptedAgentModel();
    const deps = dependencies(provider, model);

    // 1. Pergunta de preço em linguagem informal.
    model.then(
      toolCall("search_knowledge", { query: "preço botox" }),
      finalReply("Oi! Sou a assistente virtual da clínica 😊 O botox fica em R$ 1.200,00, em até 3x no cartão. Como posso te chamar?", {
        intent: "pricing",
        source_refs: ["K1"],
      }),
    );
    const { conversationId } = await receive(phone, "oii qto ta o botox??", at(0));
    await processAssistantQueue(db, deps, { now: at(1) });
    const firstRun = await db.assistantRun.findFirstOrThrow({ orderBy: { createdAt: "asc" } });
    expect(firstRun).toMatchObject({
      status: "COMPLETED",
      engine: "scripted:test",
      intent: "pricing",
      outcome: "ASKED",
      sourceEntryIds: [entryId],
      toolCalls: ["search_knowledge"],
      modelCalls: 2,
      inputTokens: 2_000,
      outputTokens: 400,
    });
    expect(firstRun.costMicros).toBeGreaterThan(0);
    expect(provider.sent.at(-1)!.body).toContain("R$ 1.200,00");
    // O contexto enviado ao provedor tem a base aprovada e nenhum telefone.
    expect(contextOf(model, 0)).toContain("R$ 1.200,00");
    expect(contextOf(model, 0)).not.toContain(phone.slice(3));

    // 2. Nome: o lead é criado pelo assistente, sem duplicar o telefone.
    model.then(toolCall("register_lead", { name: "ana souza", interest: "botox" }), finalReply("Prazer, Ana! Quer agendar uma avaliação?"));
    await receive(phone, "me chamo ana souza", at(2));
    await processAssistantQueue(db, deps, { now: at(3) });
    const lead = await db.lead.findUniqueOrThrow({ where: { phone } });
    expect(lead).toMatchObject({ name: "Ana Souza", source: "WHATSAPP", interest: "botox" });
    expect((await db.whatsAppConversation.findUniqueOrThrow({ where: { id: conversationId } })).leadId).toBe(lead.id);

    // 3. Pedido de horário: horários reais da agenda e proposta — nada é gravado ainda.
    model.then(
      toolCall("check_availability", { purpose: "new", appointment_ref: "", date: "2026-11-03", period: "afternoon", weekday: -1 }),
      toolCall("propose_booking", { slot_ref: "S1", return_ref: "" }),
      finalReply("Tenho terça à tarde! Posso confirmar o primeiro horário pra você?", { intent: "schedule" }),
    );
    await receive(phone, "pode ser terça de tarde?", at(4));
    await processAssistantQueue(db, deps, { now: at(5) });
    expect(await db.appointment.count()).toBe(0);
    const conversation = await db.whatsAppConversation.findUniqueOrThrow({ where: { id: conversationId } });
    const pending = (conversation.assistantState as { pendingAction: { slot: { startsAt: string; dateKey: string } } }).pendingAction;
    expect(pending.slot.dateKey).toBe("2026-11-03");

    // 4. Confirmação explícita: o servidor grava e só então a IA confirma.
    model.then(toolCall("confirm_pending_action"), finalReply("Prontinho, Ana! Agendei sua avaliação para terça à tarde.", { intent: "schedule" }));
    await receive(phone, "sim, pode marcar", at(6));
    await processAssistantQueue(db, deps, { now: at(7) });
    const appointment = await db.appointment.findFirstOrThrow();
    expect(appointment).toMatchObject({ leadId: lead.id, professionalId: team.professional.id, status: "SCHEDULED" });
    expect(appointment.startsAt.toISOString()).toBe(pending.slot.startsAt);
    expect((await db.lead.findUniqueOrThrow({ where: { id: lead.id } })).status).toBe("SCHEDULED");
    expect(await db.auditLog.count({ where: { action: "appointment.create", actorId: ASSISTANT_USER_ID } })).toBe(1);
    const confirmation = provider.sent.at(-1)!.body;
    expect(confirmation).toContain("Agendei sua avaliação");
    expect(confirmation).toContain(DEFAULT_ASSISTANT_CONFIG.messages.consentQuestion);
    expect((await db.assistantRun.findFirstOrThrow({ orderBy: { createdAt: "desc" } })).outcome).toBe("BOOKED");

    // 5. Resposta ao consentimento: tratada pelo servidor, sem chamar a IA.
    const callsBefore = model.requests.length;
    await receive(phone, "sim", at(8));
    await processAssistantQueue(db, deps, { now: at(9) });
    expect(model.requests.length).toBe(callsBefore);
    expect((await db.lead.findUniqueOrThrow({ where: { id: lead.id } })).whatsappOptIn).toBe(true);
    expect(await db.consentEvent.count({ where: { phone, granted: true, source: "ASSISTANT" } })).toBe(1);
    expect(model.pending).toBe(0);
  });

  it("isolamento: o contexto e as ferramentas só alcançam o próprio contato; observações clínicas nunca vão ao provedor", async () => {
    const { team, evaluation } = await setupClinic();
    const other = await createTestPatient(db, { fullName: "Outra Paciente Demo" });
    await db.appointment.create({
      data: {
        patientId: other.id,
        professionalId: team.professional.id,
        procedureId: evaluation.id,
        startsAt: new Date("2026-11-05T13:00:00Z"),
        endsAt: new Date("2026-11-05T14:00:00Z"),
      },
    });
    const patient = await createTestPatient(db, { fullName: "Beatriz Demo" });
    await addPatientNote(db, team.asProfessional, patient.id, { visibility: "CLINICAL", content: "NOTA-CLINICA-SIGILOSA" }, keyring.current);

    const provider = new RecordingProvider();
    const model = new ScriptedAgentModel([
      toolCall("propose_cancellation", { appointment_ref: "A1" }),
      finalReply("Não encontrei agendamentos futuros no seu nome. Quer marcar um horário?"),
    ]);
    await receive(patient.phone, "quero cancelar meu horário, meu email é bia@example.com", at(0));
    await processAssistantQueue(db, dependencies(provider, model), { now: at(1) });

    const context = contextOf(model, 0);
    expect(context).toContain("Tipo: paciente da clínica");
    expect(context).toContain("Agendamentos futuros: nenhum");
    expect(context).not.toContain("Outra Paciente");
    expect(context).not.toContain("NOTA-CLINICA-SIGILOSA");
    expect(context).not.toContain("bia@example.com");
    expect(context).toContain("[email]");
    expect(await db.appointment.count({ where: { status: "CANCELLED" } })).toBe(0);
    const toolResult = model.requests[1]!.messages.at(-1)!.content[0] as { isError: boolean };
    expect(toolResult.isError).toBe(true);
  });

  it("notas da conversa ficam cifradas no banco e voltam no próximo turno", async () => {
    await setupClinic();
    const provider = new RecordingProvider();
    const phone = uniquePhone();
    const model = new ScriptedAgentModel([
      toolCall("save_conversation_notes", { notes: "Interesse: botox. Prefere sábados de manhã. Tem medo de ficar artificial." }),
      finalReply("Entendo! O objetivo é sempre um resultado natural — na avaliação a profissional explica tudo com calma."),
    ]);
    const { conversationId } = await receive(phone, "tenho medo de ficar artificial", at(0));
    await processAssistantQueue(db, dependencies(provider, model), { now: at(1) });

    const stored = (await db.whatsAppConversation.findUniqueOrThrow({ where: { id: conversationId } })).assistantMemory!;
    expect(isSealed(stored)).toBe(true);
    expect(stored).not.toContain("botox");
    expect(openText(stored, memoryContext(conversationId), keyring)).toContain("Prefere sábados");

    model.then(finalReply("Claro! Quer que eu veja os horários disponíveis?"));
    await receive(phone, "e como funciona a avaliação?", at(30));
    await processAssistantQueue(db, dependencies(provider, model), { now: at(31) });
    expect(contextOf(model, 2)).toContain("<notas_da_conversa>");
    expect(contextOf(model, 2)).toContain("Prefere sábados de manhã");
    expect(contextOf(model, 2)).toContain("Você (assistente)");
  });

  it("transferência para a equipe: a conversa muda de modo, a equipe recebe o motivo e a IA para de responder", async () => {
    await setupClinic();
    const provider = new RecordingProvider();
    const phone = uniquePhone();
    const model = new ScriptedAgentModel([
      toolCall("request_human", { reason: "Reclamação sobre atendimento anterior", urgent: true }),
      finalReply("Sinto muito por isso. Já chamei a equipe, que continua o atendimento por aqui."),
    ]);
    const { conversationId } = await receive(phone, "to muito insatisfeita com o atendimento de ontem", at(0));
    await processAssistantQueue(db, dependencies(provider, model), { now: at(1) });

    const conversation = await db.whatsAppConversation.findUniqueOrThrow({ where: { id: conversationId } });
    expect(conversation.mode).toBe("HUMAN");
    expect(conversation.handoffReason).toBe("Reclamação sobre atendimento anterior");
    const task = await db.staffTask.findFirstOrThrow({ where: { kind: "HANDOFF" } });
    expect(task).toMatchObject({ urgent: true, conversationId });
    expect(task.details).toContain("Reclamação sobre atendimento anterior");

    await receive(phone, "alô?", at(5));
    await processAssistantQueue(db, dependencies(provider, model), { now: at(6) });
    expect(model.requests).toHaveLength(2);
    expect((await db.assistantRun.findFirstOrThrow({ orderBy: { createdAt: "desc" } })).flags).toContain("human_mode");
    expect(provider.sent).toHaveLength(1);
  });

  it("limite mensal de gasto atingido: segue pelo motor por regras e a equipe é avisada", async () => {
    await setupClinic();
    const provider = new RecordingProvider();
    const seed = await db.whatsAppConversation.create({ data: { contactPhone: uniquePhone() } });
    await db.assistantRun.create({
      data: { conversationId: seed.id, kind: "FOLLOW_UP", followUpKey: "seed", status: "COMPLETED", costMicros: 60_000_000, createdAt: at(-60) },
    });
    const model = new ScriptedAgentModel();
    await receive(uniquePhone(), "quanto custa o botox?", at(0));
    await processAssistantQueue(db, dependencies(provider, model), { now: at(1) });

    const run = await db.assistantRun.findFirstOrThrow({ where: { kind: "REPLY" } });
    expect(run.engine).toBe("rules");
    expect(run.flags).toContain("budget_exceeded");
    expect(model.requests).toHaveLength(0);
    expect(await db.staffTask.count({ where: { title: "Limite mensal de gasto com IA atingido" } })).toBe(1);
    expect(provider.sent.at(-1)!.body).toContain("R$ 1.200,00");
  });

  it("falha temporária da IA: nova tentativa com o consumo registrado; esgotadas, a equipe assume", async () => {
    await setupClinic();
    const provider = new RecordingProvider();
    const { AssistantModelError } = await import("@/server/assistant/types");
    const transient = () => new AssistantModelError("Instabilidade no provedor de IA.", "provider_unavailable", true);
    const model = new ScriptedAgentModel([toolCall("list_services"), transient(), transient(), transient()]);
    const { conversationId } = await receive(uniquePhone(), "oi", at(0));

    await processAssistantQueue(db, dependencies(provider, model), { now: at(1) });
    let run = await db.assistantRun.findFirstOrThrow();
    expect(run).toMatchObject({ status: "PENDING", errorCode: "provider_unavailable", modelCalls: 1, inputTokens: 1_000, toolCalls: ["list_services"] });

    await processAssistantQueue(db, dependencies(provider, model), { now: at(3) });
    await processAssistantQueue(db, dependencies(provider, model), { now: at(10) });
    run = await db.assistantRun.findFirstOrThrow();
    expect(run).toMatchObject({ status: "FAILED", outcome: "ERROR", attempts: 3 });
    expect(run.flags).toContain("fallback_handoff");
    expect((await db.whatsAppConversation.findUniqueOrThrow({ where: { id: conversationId } })).mode).toBe("HUMAN");
    expect(provider.sent).toHaveLength(1);
  });

  it("janela de 24h fechada: a resposta da IA não é enviada e vira tarefa", async () => {
    await setupClinic();
    const provider = new RecordingProvider();
    const model = new ScriptedAgentModel([finalReply("Oi! Como posso ajudar?")]);
    await receive(uniquePhone(), "oi", at(-25 * 60));
    await processAssistantQueue(db, dependencies(provider, model), { now: at(0) });
    const run = await db.assistantRun.findFirstOrThrow();
    expect(run.flags).toContain("delivery:outside_service_window");
    expect(provider.sent).toHaveLength(0);
    expect(await db.staffTask.count({ where: { kind: "AUTOMATION_FAILURE" } })).toBe(1);
  });
});

describe("renovação de protocolos (retorno previsto)", () => {
  it("convida, agenda vinculado ao retorno com confirmação e encerra os lembretes do retorno", async () => {
    const { team } = await setupClinic();
    const procedure = await createTestProcedure(db, { name: "Bioestimulador" });
    const patient = await createTestPatient(db, { fullName: "Carla Demo", whatsappOptIn: true });
    const { id: returnId } = await createReturn(
      db,
      team.asProfessional,
      patient.id,
      returnCreateSchema.parse({ title: "Segunda sessão", dueDate: "2026-11-20", procedureId: procedure.id }),
      CLOCK,
    );
    expect(await db.reminder.count({ where: { returnId, status: "PENDING" } })).toBe(1);

    const provider = new RecordingProvider();
    const model = new ScriptedAgentModel([
      toolCall("check_availability", { purpose: "new", appointment_ref: "", date: "", period: "", weekday: 3 }),
      toolCall("propose_booking", { slot_ref: "S1", return_ref: "R1" }),
      finalReply("Claro, Carla! Tenho quarta disponível. Posso confirmar?", { intent: "schedule" }),
    ]);
    await receive(patient.phone, "oi! vi que tá chegando a segunda sessão, queria marcar", at(0));
    await processAssistantQueue(db, dependencies(provider, model), { now: at(1) });
    const context = contextOf(model, 0);
    expect(context).toContain("R1 — Segunda sessão — Bioestimulador, previsto para 20/11/2026");
    expect(context).toContain("definidos pela profissional");

    model.then(toolCall("confirm_pending_action"), finalReply("Agendei sua segunda sessão para quarta. Até lá!"));
    await receive(patient.phone, "confirmo", at(3));
    await processAssistantQueue(db, dependencies(provider, model), { now: at(4) });

    const linked = await db.patientReturn.findUniqueOrThrow({ where: { id: returnId } });
    expect(linked.status).toBe("SCHEDULED");
    const appointment = await db.appointment.findUniqueOrThrow({ where: { id: linked.appointmentId! } });
    expect(appointment.patientId).toBe(patient.id);
    expect(await db.reminder.count({ where: { returnId, status: "PENDING" } })).toBe(0);
  });

  it("sem interesse agora: registra a resposta e avisa a equipe, sem mexer no acompanhamento clínico", async () => {
    const { team } = await setupClinic();
    const patient = await createTestPatient(db, { fullName: "Dora Demo" });
    const { id: returnId } = await createReturn(
      db,
      team.asProfessional,
      patient.id,
      returnCreateSchema.parse({ title: "Revisão", dueDate: "2026-11-25" }),
      CLOCK,
    );
    const model = new ScriptedAgentModel([
      toolCall("record_return_response", { return_ref: "R1", response: "not_now" }),
      finalReply("Tudo bem, Dora! Quando quiser, é só me chamar por aqui."),
    ]);
    await receive(patient.phone, "agora não consigo, depois eu vejo", at(0));
    await processAssistantQueue(db, dependencies(new RecordingProvider(), model), { now: at(1) });

    expect((await db.patientReturn.findUniqueOrThrow({ where: { id: returnId } })).status).toBe("PENDING");
    expect(await db.interaction.count({ where: { patientId: patient.id, content: { contains: "prefere não agendar agora" } } })).toBe(1);
    expect(await db.staffTask.count({ where: { kind: "FOLLOW_UP", returnId } })).toBe(1);
  });
});

describe("recuperação de oportunidades", () => {
  async function conversationWaitingContact(model: ScriptedAgentModel, provider: RecordingProvider) {
    await setupClinic();
    await configure({
      ...DEFAULT_ASSISTANT_CONFIG,
      agent: { ...DEFAULT_ASSISTANT_CONFIG.agent, followUp: { enabled: true, nudgeAfterHours: 2, staleLeadDays: 3 } },
    });
    const phone = uniquePhone();
    model.then(finalReply("O botox fica em R$ 1.200,00. Quer agendar uma avaliação?", { source_refs: ["K1"] }));
    const { conversationId } = await receive(phone, "quanto custa o botox?", at(0));
    await processAssistantQueue(db, dependencies(provider, model), { now: at(1) });
    return { phone, conversationId };
  }

  it("contato parou de responder: um único acompanhamento gerado pela IA, dentro da janela e do horário permitido", async () => {
    const provider = new RecordingProvider();
    const model = new ScriptedAgentModel();
    const { conversationId } = await conversationWaitingContact(model, provider);
    const config = await db.assistantSettings.findUniqueOrThrow({ where: { id: "default" } });
    const settings = config.config as unknown as AssistantConfig;

    // Cedo demais: nada.
    expect(await scheduleFollowUps(db, { now: at(60), timeZone: TZ, config: settings, agentAvailable: true })).toMatchObject({ queued: 0 });

    // Depois de 2h de silêncio (12:00, dia útil): um acompanhamento na fila.
    expect(await scheduleFollowUps(db, { now: at(180), timeZone: TZ, config: settings, agentAvailable: true })).toMatchObject({ queued: 1 });
    expect(await scheduleFollowUps(db, { now: at(181), timeZone: TZ, config: settings, agentAvailable: true })).toMatchObject({ queued: 0 });

    model.then(finalReply("Oi! Ficou alguma dúvida sobre a avaliação? Posso ver horários pra você 😊", { intent: "follow_up" }));
    await processAssistantQueue(db, dependencies(provider, model), { now: at(182) });
    const followUp = (await outbound(conversationId)).at(-1)!;
    expect(followUp).toMatchObject({ origin: "FOLLOW_UP", status: "SENT" });
    expect(followUp.text).toContain("Ficou alguma dúvida");
    expect(contextOf(model, 1)).toContain("não responde há cerca de 3 horas");
    const run = await db.assistantRun.findFirstOrThrow({ where: { kind: "FOLLOW_UP" } });
    expect(run).toMatchObject({ status: "COMPLETED", modelCalls: 1 });

    // A última mensagem agora é o acompanhamento: não há segundo.
    expect(await scheduleFollowUps(db, { now: at(400), timeZone: TZ, config: settings, agentAvailable: true })).toMatchObject({ queued: 0 });
  });

  it("acompanhamento respeita descadastro, atendimento humano e horário permitido", async () => {
    const provider = new RecordingProvider();
    const model = new ScriptedAgentModel();
    const { conversationId } = await conversationWaitingContact(model, provider);
    const settings = (await db.assistantSettings.findUniqueOrThrow({ where: { id: "default" } })).config as unknown as AssistantConfig;

    // 21h (fora do horário permitido 08–20h).
    expect(await scheduleFollowUps(db, { now: at(11 * 60), timeZone: TZ, config: settings, agentAvailable: true })).toMatchObject({ queued: 0 });

    await db.whatsAppConversation.update({ where: { id: conversationId }, data: { mode: "HUMAN" } });
    expect(await scheduleFollowUps(db, { now: at(180), timeZone: TZ, config: settings, agentAvailable: true })).toMatchObject({ queued: 0 });

    await db.whatsAppConversation.update({ where: { id: conversationId }, data: { mode: "ASSISTANT", optedOutAt: at(10) } });
    expect(await scheduleFollowUps(db, { now: at(180), timeZone: TZ, config: settings, agentAvailable: true })).toMatchObject({ queued: 0 });

    // Desligado na configuração (padrão): nada, mesmo elegível.
    await db.whatsAppConversation.update({ where: { id: conversationId }, data: { optedOutAt: null } });
    const off = { ...settings, agent: { ...settings.agent, followUp: { ...settings.agent.followUp, enabled: false } } };
    expect(await scheduleFollowUps(db, { now: at(180), timeZone: TZ, config: off, agentAvailable: true })).toMatchObject({ queued: 0 });
    expect(await db.assistantRun.count({ where: { kind: "FOLLOW_UP" } })).toBe(0);
  });

  it("lead parado fora da janela: vira tarefa para a equipe, uma única vez", async () => {
    const { team } = await setupClinic();
    const settings = { ...DEFAULT_ASSISTANT_CONFIG, agent: { ...DEFAULT_ASSISTANT_CONFIG.agent, followUp: { enabled: true, nudgeAfterHours: 2, staleLeadDays: 3 } } };
    const phone = uniquePhone();
    const lead = await db.lead.create({ data: { name: "Eva Demo", phone, source: "WHATSAPP", status: "IN_PROGRESS" } });
    await db.whatsAppConversation.create({
      data: { contactPhone: phone, leadId: lead.id, lastInboundAt: at(-5 * 24 * 60), lastMessageAt: at(-4 * 24 * 60) },
    });

    const first = await scheduleFollowUps(db, { now: at(0), timeZone: TZ, config: settings, agentAvailable: true });
    expect(first.staleLeadTasks).toBe(1);
    const task = await db.staffTask.findFirstOrThrow({ where: { leadId: lead.id } });
    expect(task.title).toBe("Lead sem resposta: Eva");
    expect(task.details).toContain("modelo aprovado pela Meta");

    await completeTask(db, team.asReception, task.id, at(1));
    const again = await scheduleFollowUps(db, { now: at(60), timeZone: TZ, config: settings, agentAvailable: true });
    expect(again.staleLeadTasks).toBe(0);
    expect(await db.staffTask.count({ where: { leadId: lead.id } })).toBe(1);
  });
});
