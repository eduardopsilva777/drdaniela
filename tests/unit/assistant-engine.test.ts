import { describe, expect, it } from "vitest";

import { DEFAULT_ASSISTANT_CONFIG, type AssistantConfig } from "@/lib/assistant-config";
import { runTurn, type ContactContext, type PortResult, type TurnPorts, type TurnResult } from "@/server/assistant/engine";
import { RulesAssistantModel } from "@/server/assistant/rules-model";
import { initialAssistantState, type AppointmentOption, type AssistantState, type StoredSlot } from "@/server/assistant/state";
import { normalizeText } from "@/server/assistant/text";
import { emptyInterpretation, type AssistantModel, type KnowledgePassage } from "@/server/assistant/types";

const NOW = new Date("2026-11-02T13:00:00Z");
const PROCEDURE_ID = "00000000-0000-7000-8000-00000000b070";
const PROFESSIONAL_ID = "00000000-0000-7000-8000-00000000c001";

const PASSAGES: KnowledgePassage[] = [
  {
    id: "00000000-0000-7000-8000-000000000001",
    title: "Quanto custa a avaliação?",
    content: "A avaliação custa R$ 150,00 e o valor é abatido no procedimento.",
    keywords: "valor, preço, consulta",
    category: "PRICING",
    procedureName: "Avaliação estética",
  },
  {
    id: "00000000-0000-7000-8000-000000000002",
    title: "Onde fica a clínica?",
    content: "Rua das Flores, 123, Centro.",
    keywords: "endereço, localização, onde fica",
    category: "CLINIC_INFO",
    procedureName: null,
  },
];

const SLOTS: StoredSlot[] = [
  { startsAt: "2026-11-03T13:00:00.000Z", professionalId: PROFESSIONAL_ID, durationMinutes: 30, dateKey: "2026-11-03", time: "10:00", label: "Ter, 03/11 às 10:00" },
  { startsAt: "2026-11-03T17:00:00.000Z", professionalId: PROFESSIONAL_ID, durationMinutes: 30, dateKey: "2026-11-03", time: "14:00", label: "Ter, 03/11 às 14:00" },
  { startsAt: "2026-11-04T12:00:00.000Z", professionalId: PROFESSIONAL_ID, durationMinutes: 30, dateKey: "2026-11-04", time: "09:00", label: "Qua, 04/11 às 09:00" },
];

const UPCOMING: AppointmentOption = {
  id: "00000000-0000-7000-8000-00000000a001",
  label: "Sex, 06/11 às 15:00 (Avaliação estética)",
  dateLabel: "sexta-feira, 06/11",
  time: "15:00",
  professionalId: PROFESSIONAL_ID,
  durationMinutes: 30,
};

type Calls = Record<string, unknown[][]>;

function makePorts(overrides: Partial<TurnPorts> = {}) {
  const calls: Calls = {};
  const track = (name: string, args: unknown[]) => {
    (calls[name] ??= []).push(args);
  };
  const ok: PortResult = { ok: true };
  const ports: TurnPorts = {
    searchKnowledge: async () => PASSAGES,
    matchProcedure: async (text) => (normalizeText(text).includes("botox") ? { id: PROCEDURE_ID, name: "Toxina botulínica" } : null),
    findSlots: async (request) => {
      track("findSlots", [request]);
      return { slots: SLOTS, matchedPreference: true, procedureName: "Avaliação estética" };
    },
    ensureLead: async (data) => {
      track("ensureLead", [data]);
      return true;
    },
    book: async (slot) => {
      track("book", [slot]);
      return ok;
    },
    listUpcomingAppointments: async () => [],
    reschedule: async (id, slot) => {
      track("reschedule", [id, slot]);
      return ok;
    },
    cancelAppointment: async (id) => {
      track("cancelAppointment", [id]);
      return ok;
    },
    optOut: async () => track("optOut", []),
    optIn: async () => track("optIn", []),
    grantRemindersConsent: async () => track("grantRemindersConsent", []),
    handoff: async (reason, options) => track("handoff", [reason, options]),
    registerQualifiedLead: async (summary) => track("registerQualifiedLead", [summary]),
    recordGap: async (reason, question) => track("recordGap", [reason, question]),
    ...overrides,
  };
  return { ports, calls };
}

const UNKNOWN: ContactContext = { kind: "unknown", firstName: null, ambiguous: false, remindersConsent: false, optedOut: false };
const PATIENT: ContactContext = { kind: "patient", firstName: "Joana", ambiguous: false, remindersConsent: true, optedOut: false };

async function converse(
  messages: string[],
  options: {
    ports?: TurnPorts;
    contact?: ContactContext;
    config?: AssistantConfig;
    mode?: "ASSISTANT" | "HUMAN";
    model?: AssistantModel;
    state?: AssistantState;
  } = {},
): Promise<TurnResult[]> {
  const ports = options.ports ?? makePorts().ports;
  let state = options.state ?? initialAssistantState();
  const results: TurnResult[] = [];
  for (const text of messages) {
    const result = await runTurn(
      {
        text,
        maskedText: text,
        history: [],
        mode: options.mode ?? "ASSISTANT",
        now: NOW,
        today: "2026-11-02",
        todayLabel: "Segunda-feira, 02/11/2026",
        config: options.config ?? DEFAULT_ASSISTANT_CONFIG,
        contact: options.contact ?? UNKNOWN,
        state,
      },
      ports,
      options.model ?? new RulesAssistantModel(),
    );
    state = result.state;
    results.push(result);
  }
  return results;
}

describe("descadastro e atendimento humano", () => {
  it("PARAR descadastra e confirma, mesmo com a equipe atendendo", async () => {
    const { ports, calls } = makePorts();
    const [result] = await converse(["PARAR"], { ports, mode: "HUMAN" });
    expect(result).toMatchObject({ outcome: "OPT_OUT" });
    expect(result!.reply).toBe(DEFAULT_ASSISTANT_CONFIG.messages.optOutConfirmation);
    expect(calls.optOut).toHaveLength(1);
  });

  it("com a equipe atendendo, o assistente fica em silêncio", async () => {
    const { ports, calls } = makePorts();
    const [result] = await converse(["quanto custa a avaliação?"], { ports, mode: "HUMAN" });
    expect(result).toMatchObject({ outcome: "SILENT", reply: null });
    expect(calls.handoff).toBeUndefined();
  });

  it("VOLTAR reativa as mensagens", async () => {
    const { ports, calls } = makePorts();
    const [result] = await converse(["voltar"], { ports });
    expect(result!.outcome).toBe("OPT_IN");
    expect(calls.optIn).toHaveLength(1);
  });

  it("CANCELAR com agendamento futuro pergunta antes; sem agendamento, descadastra", async () => {
    const withAppointment = makePorts({ listUpcomingAppointments: async () => [UPCOMING] });
    const [ask, choice] = await converse(["CANCELAR", "2"], { ports: withAppointment.ports, contact: PATIENT });
    expect(ask!.outcome).toBe("ASKED");
    expect(ask!.reply).toContain("cancelar um agendamento ou parar de receber");
    expect(choice!.outcome).toBe("OPT_OUT");
    expect(withAppointment.calls.cancelAppointment).toBeUndefined();

    const without = makePorts();
    const [direct] = await converse(["cancelar"], { ports: without.ports, contact: PATIENT });
    expect(direct!.outcome).toBe("OPT_OUT");
  });

  it("pedido de atendente vai para a equipe", async () => {
    const { ports, calls } = makePorts();
    const [result] = await converse(["quero falar com uma atendente"], { ports });
    expect(result!.outcome).toBe("HANDOFF");
    expect(result!.reply).toContain("assistente virtual"); // apresentação na primeira resposta
    expect(calls.handoff?.[0]?.[0]).toBe("Pediu para falar com a equipe");
  });
});

describe("respostas com a base aprovada", () => {
  it("responde com o texto aprovado, apresenta-se e pede o nome do novo contato", async () => {
    const [result] = await converse(["quanto custa a avaliação?"]);
    expect(result!.outcome).toBe("ANSWERED");
    expect(result!.sourceIds).toEqual([PASSAGES[0]!.id]);
    expect(result!.reply).toMatch(/^Olá! Eu sou Assistente virtual, assistente virtual da Clínica Dra\. Daniela Zilioli\./);
    expect(result!.reply).toContain("R$ 150,00");
    expect(result!.reply).toContain(DEFAULT_ASSISTANT_CONFIG.messages.askName);
    expect(result!.reply).not.toMatch(/sou a Dra|Daniela aqui/i);
  });

  it("sem resposta aprovada admite que não sabe, registra a pendência e oferece a equipe", async () => {
    const { ports, calls } = makePorts();
    const [noAnswer, accept] = await converse(["vocês atendem pets?", "sim"], { ports, contact: PATIENT });
    expect(noAnswer!.outcome).toBe("NO_ANSWER");
    expect(noAnswer!.reply).toContain("prefiro não arriscar");
    expect(calls.recordGap?.[0]).toEqual(["NO_ANSWER", "vocês atendem pets?"]);
    expect(accept!.outcome).toBe("HANDOFF");
  });

  it("depois de perguntas seguidas sem resposta, chama a equipe", async () => {
    const { ports, calls } = makePorts();
    const results = await converse(["vocês atendem pets?", "e aceitam bitcoin?"], { ports, contact: PATIENT });
    expect(results.map((result) => result.outcome)).toEqual(["NO_ANSWER", "HANDOFF"]);
    expect(calls.handoff).toHaveLength(1);
  });

  it("resposta do modelo com preço fora da fonte é bloqueada (nunca inventa valores)", async () => {
    const lying: AssistantModel = {
      name: "fake",
      interpret: async () => ({
        ...emptyInterpretation("pricing"),
        answer: { found: true, text: "A avaliação custa R$ 99,00.", sourceIds: [PASSAGES[0]!.id] },
      }),
    };
    const { ports, calls } = makePorts();
    const [result] = await converse(["quanto custa?"], { ports, model: lying, contact: PATIENT });
    expect(result!.outcome).toBe("NO_ANSWER");
    expect(result!.flags).toContain("guard:price");
    expect(result!.reply).not.toContain("99");
    expect(calls.recordGap?.[0]?.[0]).toBe("BLOCKED_ANSWER");
  });
});

describe("saúde: nada de orientação clínica", () => {
  it("pergunta de saúde vai para a equipe sem resposta do assistente", async () => {
    const { ports, calls } = makePorts();
    const [result] = await converse(["estou grávida, posso fazer botox?"], { ports, contact: PATIENT });
    expect(result!.outcome).toBe("HANDOFF");
    expect(result!.flags).toContain("clinical_question");
    expect(result!.reply).toContain(DEFAULT_ASSISTANT_CONFIG.messages.clinicalDeflection);
    expect(calls.handoff?.[0]?.[1]).toEqual({ urgent: false });
  });

  it("possível urgência: orienta procurar atendimento e avisa a equipe com prioridade", async () => {
    const { ports, calls } = makePorts();
    const [result] = await converse(["estou com muita dor e o lábio muito inchado depois do preenchimento"], { ports, contact: PATIENT });
    expect(result!.outcome).toBe("HANDOFF");
    expect(result!.reply).toContain("SAMU (192)");
    expect(calls.handoff?.[0]?.[1]).toEqual({ urgent: true });
  });
});

describe("captação e qualificação", () => {
  it("cumprimenta, pede o nome, faz as perguntas e registra o próximo passo", async () => {
    const { ports, calls } = makePorts();
    const results = await converse(["Oi", "Ana Paula", "botox", "de manhã", "2"], { ports });
    expect(results[0]!.reply).toContain(DEFAULT_ASSISTANT_CONFIG.messages.askName);
    expect(results[1]!.reply).toContain("Prazer, Ana!");
    expect(results[1]!.reply).toContain(DEFAULT_ASSISTANT_CONFIG.qualification[0]!.question);
    expect(results[2]!.reply).toContain(DEFAULT_ASSISTANT_CONFIG.qualification[1]!.question);
    expect(results[3]!.reply).toContain("1. Agendar");
    expect(results[4]!.reply).toContain("Perfeito, Ana!");
    expect(calls.ensureLead?.[0]?.[0]).toMatchObject({ name: "Ana Paula" });
    expect(calls.registerQualifiedLead?.[0]?.[0]).toEqual({
      nextStep: "contact",
      interest: "Toxina botulínica",
      answers: { periodo: "manhã" },
    });
  });
});

describe("agendamento com confirmação explícita", () => {
  it("pede o nome, oferece horários reais, confirma e só então agenda", async () => {
    const { ports, calls } = makePorts();
    const results = await converse(["quero agendar uma avaliação", "Maria Souza", "2", "sim", "sim"], { ports });
    expect(results.map((result) => result.outcome)).toEqual(["ASKED", "OFFERED_SLOTS", "AWAITING_CONFIRMATION", "BOOKED", "ANSWERED"]);
    expect(results[1]!.reply).toContain("2. Ter, 03/11 às 14:00");
    expect(calls.book).toHaveLength(1);
    expect(calls.book?.[0]?.[0]).toEqual(SLOTS[1]);
    expect(results[3]!.reply).toContain("Pronto, Maria! Seu horário está agendado para terça-feira, 03/11 às 14:00");
    expect(results[3]!.reply).toContain(DEFAULT_ASSISTANT_CONFIG.messages.consentQuestion);
    expect(calls.grantRemindersConsent).toHaveLength(1);
    expect(calls.registerQualifiedLead?.[0]?.[0]).toMatchObject({ nextStep: "schedule" });
  });

  it("“sim” sem confirmação pendente não agenda nada", async () => {
    const { ports, calls } = makePorts();
    const [result] = await converse(["sim"], { ports, contact: PATIENT });
    expect(calls.book).toBeUndefined();
    expect(result!.outcome).toBe("ASKED");
  });

  it("horário ocupado na hora de gravar: avisa e oferece outros", async () => {
    const { ports, calls } = makePorts({ book: async () => ({ ok: false, reason: "conflict" }) });
    const results = await converse(["quero marcar um horário", "1", "sim"], { ports, contact: PATIENT });
    expect(results[2]!.outcome).toBe("OFFERED_SLOTS");
    expect(results[2]!.reply).toContain("Esse horário acabou de ser ocupado.");
    expect(results[2]!.reply).not.toMatch(/agendado para/);
    expect(calls.findSlots).toHaveLength(2);
  });

  it("erro ao gravar: nunca confirma e chama a equipe", async () => {
    const { ports, calls } = makePorts({ book: async () => ({ ok: false, reason: "error" }) });
    const results = await converse(["quero agendar", "1", "sim"], { ports, contact: PATIENT });
    expect(results[2]!.outcome).toBe("HANDOFF");
    expect(results[2]!.reply).not.toMatch(/agendado para/);
    expect(calls.handoff?.[0]?.[0]).toBe("Falha ao agendar pelo assistente");
  });

  it("agendamento pelo assistente desativado ou sem horários: encaminha para a equipe", async () => {
    const disabled = makePorts({ findSlots: async () => null });
    const [result] = await converse(["quero agendar"], { ports: disabled.ports, contact: PATIENT });
    expect(result!.outcome).toBe("HANDOFF");
    expect(result!.reply).toContain("verificar os horários disponíveis");

    const empty = makePorts({ findSlots: async () => ({ slots: [], matchedPreference: true, procedureName: "Avaliação" }) });
    const [noSlots] = await converse(["quero agendar"], { ports: empty.ports, contact: PATIENT });
    expect(noSlots!.reply).toContain("não encontrei horários disponíveis");
  });

  it("telefone de mais de um paciente: não mexe na agenda sem a equipe", async () => {
    const { ports, calls } = makePorts();
    const [result] = await converse(["quero agendar"], { ports, contact: { ...PATIENT, ambiguous: true } });
    expect(result!.outcome).toBe("HANDOFF");
    expect(calls.findSlots).toBeUndefined();
  });

  it("remarca o agendamento do próprio contato depois de confirmar", async () => {
    const { ports, calls } = makePorts({ listUpcomingAppointments: async () => [UPCOMING] });
    const results = await converse(["preciso remarcar minha consulta", "3", "sim"], { ports, contact: PATIENT });
    expect(results.map((result) => result.outcome)).toEqual(["OFFERED_SLOTS", "AWAITING_CONFIRMATION", "RESCHEDULED"]);
    expect(calls.findSlots?.[0]?.[0]).toMatchObject({ reschedule: UPCOMING });
    expect(calls.reschedule?.[0]).toEqual([UPCOMING.id, SLOTS[2]]);
  });

  it("cancela só depois do SIM e confirma a data cancelada", async () => {
    const { ports, calls } = makePorts({ listUpcomingAppointments: async () => [UPCOMING] });
    const [ask, keep] = await converse(["quero cancelar minha consulta", "não"], { ports, contact: PATIENT });
    expect(ask!.outcome).toBe("AWAITING_CONFIRMATION");
    expect(keep!.reply).toContain("continua marcado");
    expect(calls.cancelAppointment).toBeUndefined();

    const [, confirmed] = await converse(["quero cancelar minha consulta", "sim"], { ports, contact: PATIENT });
    expect(confirmed!.outcome).toBe("APPOINTMENT_CANCELLED");
    expect(confirmed!.reply).toContain("sexta-feira, 06/11 às 15:00");
    expect(calls.cancelAppointment).toEqual([[UPCOMING.id]]);
  });
});
