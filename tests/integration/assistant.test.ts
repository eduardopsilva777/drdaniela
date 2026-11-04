import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_ASSISTANT_CONFIG, type AssistantConfig } from "@/lib/assistant-config";
import { appointmentCreateSchema } from "@/lib/validation/appointments";
import { knowledgeEntryInputSchema } from "@/lib/validation/assistant";
import { RulesAssistantModel } from "@/server/assistant/rules-model";
import { AssistantModelError, type AssistantModel } from "@/server/assistant/types";
import { authenticateWithPassword } from "@/server/auth/authenticate";
import { AuthorizationError } from "@/server/auth/errors";
import { DEFAULT_LOGIN_THROTTLE_POLICY } from "@/server/auth/login-throttle";
import { hashPassword } from "@/server/auth/password";
import { messageContext, openText } from "@/server/crypto/content-cipher";
import { getContentKeyring } from "@/server/crypto/content-key";
import { NotFoundError } from "@/server/errors";
import { createAppointment } from "@/server/services/appointments";
import { processAssistantQueue, type AssistantDependencies } from "@/server/services/assistant";
import { ASSISTANT_USER_ID, getAssistantActor } from "@/server/services/assistant-actor";
import { saveAssistantConfig } from "@/server/services/assistant-settings";
import { approveKnowledgeVersion, createKnowledgeEntry } from "@/server/services/knowledge";
import { updateStaffAccount } from "@/server/services/users";
import {
  eraseConversationContent,
  processWebhookPayload,
  recordInboundMessage,
  retryAutomatedMessages,
  sendTextMessage,
} from "@/server/services/whatsapp";
import { WhatsAppSendError, type WhatsAppProvider } from "@/server/whatsapp/types";
import { webhookPayloadSchema } from "@/server/whatsapp/webhook";

import { CLOCK, createTeam, createTestDb, createTestPatient, createTestProcedure, NOW, resetDatabase, TEST_PASSWORD, TZ, uniquePhone } from "./helpers";

const db = createTestDb();
const keyring = getContentKeyring();

beforeEach(() => resetDatabase(db));
afterAll(() => db.$disconnect());

const minutes = (value: number) => new Date(NOW.getTime() + value * 60_000);

/** Provedor de teste: registra os textos "enviados" (nada sai do processo). */
class RecordingProvider implements WhatsAppProvider {
  readonly name = "cloud_api" as const;
  readonly sent: Array<{ to: string; body: string }> = [];
  failNext: "retryable" | "fatal" | null = null;
  async sendText(message: { to: string; body: string }) {
    if (this.failNext) {
      const kind = this.failNext;
      this.failNext = null;
      throw new WhatsAppSendError("Instabilidade na API.", kind === "retryable" ? "provider_unavailable" : "undeliverable", kind === "retryable");
    }
    this.sent.push(message);
    return { providerMessageId: `wamid.out.${this.sent.length}.${Math.random()}`, status: "SENT" as const };
  }
  async sendTemplate() {
    return { providerMessageId: `wamid.tpl.${Math.random()}`, status: "SENT" as const };
  }
}

function dependencies(provider: WhatsAppProvider | null, model: AssistantModel | null = new RulesAssistantModel()): AssistantDependencies {
  return { provider, model, timeZone: TZ, keyring, reminderSettings: CLOCK.reminders! };
}

let sequence = 0;
async function receive(phone: string, text: string, at: Date = NOW) {
  sequence += 1;
  return recordInboundMessage(
    db,
    { kind: "message", providerMessageId: `wamid.in.${sequence}`, from: phone.slice(1), contactName: "Contato Teste", receivedAt: at, type: "text", body: text },
    "cloud_api",
  );
}

/** Mensagem nova (não reentrega), com o id da mensagem registrada. */
async function receiveNew(phone: string, text: string, at: Date = NOW) {
  const result = await receive(phone, text, at);
  if (result.duplicate) throw new Error("Mensagem tratada como reentrega no teste.");
  return result;
}

async function replies(conversationId: string) {
  const messages = await db.whatsAppMessage.findMany({
    where: { conversationId, direction: "OUTBOUND" },
    orderBy: { createdAt: "asc" },
  });
  return messages.map((message) => ({ ...message, text: openText(message.body, messageContext(conversationId), keyring) ?? "" }));
}

async function configure(db_: typeof db, overrides: Partial<AssistantConfig>) {
  const config = { ...DEFAULT_ASSISTANT_CONFIG, ...overrides };
  await db_.assistantSettings.upsert({ where: { id: "default" }, create: { id: "default", config }, update: { config } });
}

async function publishPricingAnswer(team: Awaited<ReturnType<typeof createTeam>>) {
  const { entryId, versionId } = await createKnowledgeEntry(
    db,
    team.asReception,
    knowledgeEntryInputSchema.parse({
      category: "PRICING",
      title: "Quanto custa a avaliação?",
      content: "A avaliação custa R$ 150,00 e o valor é abatido no procedimento.",
      keywords: "valor, preço, consulta",
      submit: "on",
    }),
  );
  await approveKnowledgeVersion(db, team.asProfessional, versionId);
  return entryId;
}

describe("atendimento pelo assistente (webhook → fila → resposta)", () => {
  it("responde com a base aprovada, registra a execução e cifra a conversa no banco", async () => {
    const team = await createTeam(db);
    const entryId = await publishPricingAnswer(team);
    const provider = new RecordingProvider();
    const phone = uniquePhone();

    const { conversationId } = await receive(phone, "Oi! Quanto custa a avaliação?");
    const summary = await processAssistantQueue(db, dependencies(provider), { now: minutes(1) });
    expect(summary).toMatchObject({ claimed: 1, completed: 1, replied: 1 });

    const run = await db.assistantRun.findFirstOrThrow();
    expect(run).toMatchObject({ status: "COMPLETED", outcome: "ANSWERED", engine: "rules", sourceEntryIds: [entryId] });
    expect(run.latencyMs).toBe(60_000);

    const [reply] = await replies(conversationId);
    expect(reply).toMatchObject({ origin: "ASSISTANT", status: "SENT", idempotencyKey: `assistant:${run.id}` });
    expect(reply!.text).toContain("assistente virtual");
    expect(reply!.text).toContain("R$ 150,00");
    expect(provider.sent[0]!.body).toBe(reply!.text);
    if (keyring) expect(reply!.body).not.toContain("150");
  });

  it("reentrega do webhook não gera segunda execução nem segunda resposta", async () => {
    const team = await createTeam(db);
    await publishPricingAnswer(team);
    const provider = new RecordingProvider();
    const payload = webhookPayloadSchema.parse({
      object: "whatsapp_business_account",
      entry: [
        {
          id: "WABA",
          changes: [
            {
              field: "messages",
              value: {
                contacts: [{ wa_id: "5511977776666", profile: { name: "Contato" } }],
                messages: [{ id: "wamid.DUP", from: "5511977776666", timestamp: String(NOW.getTime() / 1000), type: "text", text: { body: "quanto custa a avaliação?" } }],
              },
            },
          ],
        },
      ],
    });
    await processWebhookPayload(db, payload);
    await processAssistantQueue(db, dependencies(provider), { now: minutes(1) });
    await processWebhookPayload(db, payload);
    await processAssistantQueue(db, dependencies(provider), { now: minutes(2) });

    expect(await db.assistantRun.count()).toBe(1);
    expect(provider.sent).toHaveLength(1);
  });

  it("mensagens em sequência são respondidas juntas (a anterior é substituída)", async () => {
    const team = await createTeam(db);
    await publishPricingAnswer(team);
    const provider = new RecordingProvider();
    const phone = uniquePhone();
    await receive(phone, "oi");
    await receive(phone, "quanto custa a avaliação?");
    await processAssistantQueue(db, dependencies(provider), { now: minutes(1) });

    const runs = await db.assistantRun.findMany({ orderBy: { createdAt: "asc" } });
    expect(runs.map((run) => run.status)).toEqual(["SKIPPED", "COMPLETED"]);
    expect(runs[0]!.flags).toContain("superseded");
    expect(provider.sent).toHaveLength(1);
    expect(provider.sent[0]!.body).toContain("R$ 150,00");
  });

  it("a execução mais antiga processada depois da mais nova não responde de novo (ordem de processamento não importa)", async () => {
    const team = await createTeam(db);
    await publishPricingAnswer(team);
    const provider = new RecordingProvider();
    const phone = uniquePhone();
    const first = await receiveNew(phone, "oi");
    await receive(phone, "quanto custa a avaliação?");
    // A primeira ficou para depois (ex.: conversa reservada por outro processador).
    await db.assistantRun.update({ where: { inboundMessageId: first.messageId! }, data: { nextAttemptAt: minutes(10) } });

    await processAssistantQueue(db, dependencies(provider), { now: minutes(1) });
    expect(provider.sent).toHaveLength(1);
    expect(provider.sent[0]!.body).toContain("R$ 150,00");

    await processAssistantQueue(db, dependencies(provider), { now: minutes(11) });
    const olderRun = await db.assistantRun.findUniqueOrThrow({ where: { inboundMessageId: first.messageId! } });
    expect(olderRun).toMatchObject({ status: "SKIPPED", outcome: "SILENT" });
    expect(olderRun.flags).toContain("superseded");
    expect(provider.sent).toHaveLength(1);
  });

  it("mensagem com uma resposta da clínica no meio não é dada como respondida pela mais nova", async () => {
    const team = await createTeam(db);
    await publishPricingAnswer(team);
    const provider = new RecordingProvider();
    const phone = uniquePhone();
    const first = await receiveNew(phone, "quanto custa a avaliação?");
    // Resposta enviada depois da primeira mensagem (ex.: a uma mensagem anterior), antes da segunda.
    await db.whatsAppMessage.create({
      data: { conversationId: first.conversationId, direction: "OUTBOUND", origin: "STAFF", body: "Já te respondo!", provider: "cloud_api", status: "SENT" },
    });
    const second = await receiveNew(phone, "obrigada");
    // A mais nova ainda aguarda: mesmo assim ela não cobre a primeira (há uma resposta entre as duas).
    await db.assistantRun.update({ where: { inboundMessageId: second.messageId! }, data: { nextAttemptAt: minutes(10) } });

    await processAssistantQueue(db, dependencies(provider), { now: minutes(1) });
    expect(await db.assistantRun.findUniqueOrThrow({ where: { inboundMessageId: first.messageId! } })).toMatchObject({
      status: "COMPLETED",
      outcome: "ANSWERED",
    });
    expect(provider.sent).toHaveLength(1);
    expect(provider.sent[0]!.body).toContain("R$ 150,00");
  });
});

describe("descadastro e consentimento", () => {
  it("PARAR bloqueia mensagens proativas do número, cancela lembretes e confirma — mesmo com o assistente desligado", async () => {
    const team = await createTeam(db);
    const procedure = await createTestProcedure(db);
    const patient = await createTestPatient(db, { whatsappOptIn: true });
    await db.patient.update({ where: { id: patient.id }, data: { marketingOptIn: true } });
    await createAppointment(
      db,
      team.asReception,
      appointmentCreateSchema.parse({
        subject: "patient",
        patientId: patient.id,
        professionalId: team.professional.id,
        procedureId: procedure.id,
        date: "2026-11-05",
        startTime: "10:00",
        durationMinutes: 60,
      }),
      CLOCK,
    );
    expect(await db.reminder.count({ where: { status: "PENDING" } })).toBe(1);

    const provider = new RecordingProvider();
    const { conversationId } = await receive(patient.phone, "PARAR");
    await processAssistantQueue(db, dependencies(provider, null), { now: minutes(1) });

    expect((await db.whatsAppConversation.findUniqueOrThrow({ where: { id: conversationId } })).optedOutAt).not.toBeNull();
    expect(await db.patient.findUniqueOrThrow({ where: { id: patient.id } })).toMatchObject({ whatsappOptIn: false, marketingOptIn: false });
    expect(await db.reminder.findFirstOrThrow()).toMatchObject({ status: "CANCELLED" });
    const events = await db.consentEvent.findMany({ orderBy: { purpose: "asc" } });
    expect(events.map((event) => [event.purpose, event.granted, event.source])).toEqual([
      ["WHATSAPP", false, "CONTACT_KEYWORD"],
      ["MARKETING", false, "CONTACT_KEYWORD"],
    ]);
    const [reply] = await replies(conversationId);
    expect(reply).toMatchObject({ origin: "SYSTEM" });
    expect(reply!.text).toBe(DEFAULT_ASSISTANT_CONFIG.messages.optOutConfirmation);
    expect(await db.auditLog.count({ where: { action: "consent.update" } })).toBe(1);

    // VOLTAR reativa só lembretes e avisos (marketing exige consentimento específico).
    await receive(patient.phone, "VOLTAR", minutes(5));
    await processAssistantQueue(db, dependencies(provider, null), { now: minutes(6) });
    expect(await db.patient.findUniqueOrThrow({ where: { id: patient.id } })).toMatchObject({ whatsappOptIn: true, marketingOptIn: false });
    expect((await db.whatsAppConversation.findUniqueOrThrow({ where: { id: conversationId } })).optedOutAt).toBeNull();
  });
});

describe("captação, qualificação e agendamento", () => {
  async function bookingSetup() {
    const team = await createTeam(db);
    const evaluation = await createTestProcedure(db, { name: "Avaliação estética", durationMinutes: 30 });
    await createTestProcedure(db, { name: "Toxina botulínica" });
    const weeklyHours: AssistantConfig["booking"]["weeklyHours"] = [[], [], [{ start: "09:00", end: "12:00" }], [{ start: "09:00", end: "12:00" }], [], [], []];
    await configure(db, {
      booking: {
        ...DEFAULT_ASSISTANT_CONFIG.booking,
        enabled: true,
        procedureId: evaluation.id,
        professionalIds: [team.professional.id],
        weeklyHours,
        minNoticeHours: 2,
      },
    });
    return { team, evaluation };
  }

  async function talk(phone: string, provider: RecordingProvider, texts: string[], startMinute = 0) {
    let minute = startMinute;
    let conversationId = "";
    for (const text of texts) {
      minute += 1;
      const result = await receive(phone, text, minutes(minute));
      conversationId = result.conversationId;
      await processAssistantQueue(db, dependencies(provider), { now: minutes(minute) });
    }
    return { conversationId, minute };
  }

  it("novo contato vira lead qualificado e agenda a avaliação só depois do SIM", async () => {
    const { team, evaluation } = await bookingSetup();
    const provider = new RecordingProvider();
    const phone = uniquePhone();

    const { conversationId, minute } = await talk(phone, provider, ["Oi", "Maria Teste", "toxina botulínica", "de manhã", "1", "1"]);
    const lead = await db.lead.findUniqueOrThrow({ where: { phone } });
    expect(lead).toMatchObject({ name: "Maria Teste", source: "WHATSAPP", sourceDetail: "Assistente virtual (WhatsApp)", status: "IN_PROGRESS", interest: "Toxina botulínica" });
    expect(await db.auditLog.findFirstOrThrow({ where: { action: "lead.create" } })).toMatchObject({ actorId: ASSISTANT_USER_ID });
    expect(await db.staffTask.findFirstOrThrow({ where: { kind: "QUALIFIED_LEAD" } })).toMatchObject({ leadId: lead.id, status: "OPEN" });
    // Horário escolhido, ainda sem SIM: nada gravado na agenda.
    expect(await db.appointment.count()).toBe(0);
    const offered = (await replies(conversationId)).at(-1)!.text;
    expect(offered).toContain("Confirma Avaliação estética em Ter, 03/11 às 09:00?");

    await talk(phone, provider, ["sim"], minute);
    const appointment = await db.appointment.findFirstOrThrow({ include: { events: true } });
    expect(appointment).toMatchObject({ leadId: lead.id, patientId: null, procedureId: evaluation.id, professionalId: team.professional.id });
    expect(appointment.events[0]).toMatchObject({ type: "CREATED", actorId: ASSISTANT_USER_ID });
    expect((await db.lead.findUniqueOrThrow({ where: { id: lead.id } })).status).toBe("SCHEDULED");
    const confirmation = (await replies(conversationId)).at(-1)!.text;
    expect(confirmation).toContain("Pronto, Maria! Seu horário está agendado para terça-feira, 03/11 às 09:00");
    expect(confirmation).toContain(DEFAULT_ASSISTANT_CONFIG.messages.consentQuestion);

    // Consentimento para lembretes registrado e lembrete do agendamento criado para o lead.
    await talk(phone, provider, ["sim"], minute + 1);
    expect((await db.lead.findUniqueOrThrow({ where: { id: lead.id } })).whatsappOptIn).toBe(true);
    expect(await db.consentEvent.findFirstOrThrow({ where: { granted: true } })).toMatchObject({ source: "ASSISTANT", leadId: lead.id });
    expect(await db.reminder.findFirstOrThrow()).toMatchObject({ kind: "APPOINTMENT", leadId: lead.id, appointmentId: appointment.id, status: "PENDING" });
  });

  it("horário ocupado entre a oferta e o SIM: avisa e oferece outros, sem agendamento duplicado", async () => {
    const { team, evaluation } = await bookingSetup();
    const provider = new RecordingProvider();
    const patient = await createTestPatient(db, { fullName: "Joana Paciente" });
    const { conversationId, minute } = await talk(patient.phone, provider, ["quero agendar uma avaliação", "1"]);

    // A recepção ocupa o mesmo horário antes do SIM.
    const other = await createTestPatient(db);
    await createAppointment(
      db,
      team.asReception,
      appointmentCreateSchema.parse({
        subject: "patient",
        patientId: other.id,
        professionalId: team.professional.id,
        procedureId: evaluation.id,
        date: "2026-11-03",
        startTime: "09:00",
        durationMinutes: 30,
      }),
      CLOCK,
    );

    await talk(patient.phone, provider, ["sim"], minute);
    const reply = (await replies(conversationId)).at(-1)!.text;
    expect(reply).toContain("Esse horário acabou de ser ocupado.");
    expect(reply).not.toContain("1. Ter, 03/11 às 09:00");
    expect(await db.appointment.count()).toBe(1);
    expect(await db.appointment.count({ where: { patientId: patient.id } })).toBe(0);
  });
});

describe("tempo de processamento do lote", () => {
  it("execução que não terminaria antes de ser considerada presa volta para a fila (sem processamento em dobro)", async () => {
    // Relógio do lote: o motor "lento" consome 4 minutos por mensagem.
    const realNow = Date.now.bind(Date);
    let offsetMs = 0;
    const clock = vi.spyOn(Date, "now").mockImplementation(() => realNow() + offsetMs);
    try {
      const rules = new RulesAssistantModel();
      const slow: AssistantModel = {
        name: "lento",
        interpret: async (input) => {
          offsetMs += 4 * 60_000;
          return rules.interpret(input);
        },
      };
      const provider = new RecordingProvider();
      const first = await receiveNew(uniquePhone(), "oi");
      const second = await receiveNew(uniquePhone(), "oi");

      const summary = await processAssistantQueue(db, dependencies(provider, slow), { now: minutes(1) });
      // 4 min já passados + 90 s de reserva > 5 min: a segunda não começa neste ciclo.
      expect(summary).toMatchObject({ claimed: 2, completed: 1, released: 1 });
      expect(await db.assistantRun.findUniqueOrThrow({ where: { inboundMessageId: first.messageId } })).toMatchObject({ status: "COMPLETED" });
      expect(await db.assistantRun.findUniqueOrThrow({ where: { inboundMessageId: second.messageId } })).toMatchObject({
        status: "PENDING",
        attempts: 0,
        lockedAt: null,
      });

      // No ciclo seguinte ela é processada normalmente.
      expect(await processAssistantQueue(db, dependencies(provider, slow), { now: minutes(2) })).toMatchObject({ claimed: 1, completed: 1 });
      expect(provider.sent).toHaveLength(2);
    } finally {
      clock.mockRestore();
    }
  });
});

describe("encaminhamento para a equipe", () => {
  it("pedido de atendente: equipe assume, assistente silencia e a resposta da equipe conclui a tarefa", async () => {
    const team = await createTeam(db);
    const provider = new RecordingProvider();
    const phone = uniquePhone();
    const { conversationId } = await receive(phone, "quero falar com uma atendente");
    await processAssistantQueue(db, dependencies(provider), { now: minutes(1) });

    expect(await db.whatsAppConversation.findUniqueOrThrow({ where: { id: conversationId } })).toMatchObject({ mode: "HUMAN" });
    expect(await db.staffTask.findFirstOrThrow()).toMatchObject({ kind: "HANDOFF", status: "OPEN", conversationId });

    await receive(phone, "alguém aí?", minutes(2));
    await processAssistantQueue(db, dependencies(provider), { now: minutes(3) });
    expect((await db.assistantRun.findFirstOrThrow({ orderBy: { createdAt: "desc" } })).outcome).toBe("SILENT");
    expect(provider.sent).toHaveLength(1);
    expect(await db.staffTask.count()).toBe(1);

    await sendTextMessage(db, provider, team.asReception, conversationId, "Olá! Aqui é a Rafaela, da recepção.", minutes(4));
    expect((await db.staffTask.findFirstOrThrow()).status).toBe("DONE");
  });

  it("falha temporária do motor: novas tentativas; esgotadas, a equipe assume e o contato é avisado", async () => {
    const failing: AssistantModel = {
      name: "falhando",
      interpret: async () => {
        throw new AssistantModelError("Instabilidade no provedor de IA.", "provider_unavailable", true);
      },
    };
    const provider = new RecordingProvider();
    const { conversationId } = await receive(uniquePhone(), "quanto custa?");
    await processAssistantQueue(db, dependencies(provider, failing), { now: minutes(1) });
    expect(await db.assistantRun.findFirstOrThrow()).toMatchObject({ status: "PENDING", attempts: 1, errorCode: "provider_unavailable" });

    await processAssistantQueue(db, dependencies(provider, failing), { now: minutes(2) });
    await processAssistantQueue(db, dependencies(provider, failing), { now: minutes(5) });
    expect(await db.assistantRun.findFirstOrThrow()).toMatchObject({ status: "FAILED", outcome: "ERROR", attempts: 3 });
    expect((await db.whatsAppConversation.findUniqueOrThrow({ where: { id: conversationId } })).mode).toBe("HUMAN");
    const [notice] = await replies(conversationId);
    expect(notice).toMatchObject({ origin: "SYSTEM" });
    expect(notice!.text).toContain("Vou chamar alguém da equipe");
  });

  it("limite de respostas automáticas por hora: a equipe assume", async () => {
    await configure(db, { limits: { ...DEFAULT_ASSISTANT_CONFIG.limits, maxRepliesPerHour: 5 } });
    const provider = new RecordingProvider();
    const phone = uniquePhone();
    const { conversationId } = await receive(phone, "oi");
    await db.whatsAppMessage.createMany({
      data: Array.from({ length: 5 }, (_, index) => ({
        conversationId,
        direction: "OUTBOUND" as const,
        origin: "ASSISTANT" as const,
        body: `resposta ${index}`,
        provider: "cloud_api",
        status: "SENT" as const,
      })),
    });
    await processAssistantQueue(db, dependencies(provider), { now: minutes(1) });
    expect(await db.assistantRun.findFirstOrThrow()).toMatchObject({ outcome: "HANDOFF", flags: expect.arrayContaining(["rate_limited"]) });
    expect((await db.whatsAppConversation.findUniqueOrThrow({ where: { id: conversationId } })).mode).toBe("HUMAN");
  });
});

describe("regras do WhatsApp no envio automático", () => {
  it("fora da janela de 24 horas a resposta não é enviada e vira tarefa", async () => {
    const provider = new RecordingProvider();
    await receive(uniquePhone(), "oi");
    await processAssistantQueue(db, dependencies(provider), { now: minutes(25 * 60) });
    expect(provider.sent).toHaveLength(0);
    expect(await db.whatsAppMessage.count({ where: { direction: "OUTBOUND" } })).toBe(0);
    expect(await db.staffTask.findFirstOrThrow()).toMatchObject({ kind: "AUTOMATION_FAILURE" });
    expect((await db.assistantRun.findFirstOrThrow()).flags).toContain("delivery:outside_service_window");
  });

  it("falha temporária no envio: fica pendente e é reenviada com espera; nunca duplica", async () => {
    const provider = new RecordingProvider();
    provider.failNext = "retryable";
    const { conversationId } = await receive(uniquePhone(), "oi");
    await processAssistantQueue(db, dependencies(provider), { now: minutes(1) });
    const [pending] = await replies(conversationId);
    expect(pending).toMatchObject({ status: "PENDING", attempts: 1 });
    expect(pending!.nextAttemptAt?.getTime()).toBe(minutes(1).getTime() + 30_000);

    expect((await retryAutomatedMessages(db, provider, minutes(1), keyring)).retried).toBe(0);
    expect(await retryAutomatedMessages(db, provider, new Date(minutes(1).getTime() + 31_000), keyring)).toMatchObject({ retried: 1, sent: 1 });
    expect(await retryAutomatedMessages(db, provider, minutes(10), keyring)).toMatchObject({ retried: 0 });
    const [sent] = await replies(conversationId);
    expect(sent).toMatchObject({ status: "SENT", attempts: 2 });
    expect(provider.sent).toHaveLength(1);
  });

  it("reenvio pendente com o texto apagado (ou ilegível) não envia nada ao contato", async () => {
    const team = await createTeam(db);
    const provider = new RecordingProvider();
    provider.failNext = "retryable";
    const { conversationId } = await receive(uniquePhone(), "oi");
    await processAssistantQueue(db, dependencies(provider), { now: minutes(1) });
    expect((await replies(conversationId))[0]).toMatchObject({ status: "PENDING", attempts: 1 });

    // Pedido de eliminação do titular antes do reenvio.
    await eraseConversationContent(db, team.asAdmin, conversationId);
    expect(await retryAutomatedMessages(db, provider, minutes(2), keyring)).toMatchObject({ retried: 1, sent: 0, failed: 1 });
    expect(provider.sent).toHaveLength(0);
    expect(await db.whatsAppMessage.findFirstOrThrow({ where: { direction: "OUTBOUND" } })).toMatchObject({
      status: "FAILED",
      errorCode: "content_unavailable",
    });
  });
});

describe("permissões e conta de sistema", () => {
  it("a conta do assistente nunca faz login, nem com senha válida, e não é gerenciável pela equipe", async () => {
    const team = await createTeam(db);
    await getAssistantActor(db);
    await db.user.update({ where: { id: ASSISTANT_USER_ID }, data: { isActive: true, passwordHash: await hashPassword(TEST_PASSWORD) } });
    const result = await authenticateWithPassword(
      db,
      { email: "assistente-virtual@sistema.invalid", password: TEST_PASSWORD, ipAddress: "127.0.0.1", userAgent: "vitest" },
      { session: { maxAgeMs: 3_600_000, idleTimeoutMs: 3_600_000, touchIntervalMs: 60_000 }, throttle: DEFAULT_LOGIN_THROTTLE_POLICY },
      NOW,
    );
    expect(result.ok).toBe(false);
    expect((await db.auditLog.findFirstOrThrow({ where: { action: "auth.login.failure" } })).metadata).toMatchObject({ reason: "system_account" });
    await expect(updateStaffAccount(db, team.asAdmin, ASSISTANT_USER_ID, { name: "X", role: "ADMIN" })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("configurações só pela administração; apagar conversa só pela administração", async () => {
    const team = await createTeam(db);
    await expect(saveAssistantConfig(db, team.asReception, DEFAULT_ASSISTANT_CONFIG)).rejects.toBeInstanceOf(AuthorizationError);
    await expect(saveAssistantConfig(db, team.asProfessional, DEFAULT_ASSISTANT_CONFIG)).rejects.toBeInstanceOf(AuthorizationError);
    await saveAssistantConfig(db, team.asAdmin, { ...DEFAULT_ASSISTANT_CONFIG, enabled: false });
    expect((await db.auditLog.findFirstOrThrow({ where: { action: "assistant.settings.update" } })).metadata).toMatchObject({ enabled: false });

    const { conversationId } = await receive(uniquePhone(), "meu cpf é 123.456.789-09");
    await expect(eraseConversationContent(db, team.asReception, conversationId)).rejects.toBeInstanceOf(AuthorizationError);
    await eraseConversationContent(db, team.asAdmin, conversationId);
    expect((await db.whatsAppMessage.findFirstOrThrow()).body).toBeNull();
  });
});
