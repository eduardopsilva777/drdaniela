import { describe, expect, it } from "vitest";

import { DEFAULT_ASSISTANT_CONFIG, fillTemplate, resolveAssistantConfig } from "@/lib/assistant-config";
import { weekdayOf, zonedDateTime } from "@/lib/datetime";
import { followUpRulesSchema, templateInputSchema } from "@/lib/validation/assistant";
import { computeAvailableSlots, formatSlotLabel } from "@/server/assistant/availability";
import { checkGroundedAnswer, extractMoneyAmounts } from "@/server/assistant/guard";
import { isConfidentMatch, rankPassages } from "@/server/assistant/knowledge-search";
import { readAssistantState } from "@/server/assistant/state";
import {
  detectConsentKeyword,
  extractName,
  parseOptionNumber,
  parseSchedulePreference,
  parseYesNo,
} from "@/server/assistant/text";
import type { KnowledgePassage } from "@/server/assistant/types";
import { extractWebhookEvents, webhookEventKey, webhookPayloadSchema } from "@/server/whatsapp/webhook";

const TZ = "America/Sao_Paulo";
const TODAY = "2026-11-02"; // segunda-feira

describe("palavras-chave de consentimento", () => {
  it.each(["PARAR", "parar", "Sair", "STOP", "descadastrar", "Não quero mais receber essas mensagens", "por favor parem de me mandar mensagem"])(
    "%s é descadastro",
    (text) => expect(detectConsentKeyword(text)).toBe("opt_out"),
  );

  it("CANCELAR sozinho é ambíguo (agendamento ou mensagens)", () => {
    expect(detectConsentKeyword("CANCELAR")).toBe("ambiguous_cancel");
    expect(detectConsentKeyword("cancela")).toBe("ambiguous_cancel");
  });

  it("VOLTAR reativa; frases comuns não disparam descadastro", () => {
    expect(detectConsentKeyword("VOLTAR")).toBe("opt_in");
    expect(detectConsentKeyword("quero cancelar minha consulta de sexta")).toBeNull();
    expect(detectConsentKeyword("quero parar de fumar antes do procedimento?")).toBeNull();
    expect(detectConsentKeyword("pode parar o carro no estacionamento?")).toBeNull();
  });
});

describe("respostas curtas", () => {
  it("sim/não", () => {
    expect(parseYesNo("Sim")).toBe(true);
    expect(parseYesNo("sim, pode confirmar")).toBe(true);
    expect(parseYesNo("👍")).toBe(true);
    expect(parseYesNo("não")).toBe(false);
    expect(parseYesNo("Nenhum desses")).toBe(false);
    expect(parseYesNo("quanto custa?")).toBeNull();
  });

  it("número da opção dentro do limite", () => {
    expect(parseOptionNumber("2", 4)).toBe(2);
    expect(parseOptionNumber("opção 3", 4)).toBe(3);
    expect(parseOptionNumber("a primeira", 4)).toBe(1);
    expect(parseOptionNumber("5", 4)).toBeNull();
    expect(parseOptionNumber("tenho 2 dúvidas", 4)).toBeNull();
  });

  it("nome informado, sem confundir pedidos com nomes", () => {
    expect(extractName("meu nome é Maria Souza", false)).toBe("Maria Souza");
    expect(extractName("Me chamo joão da silva", false)).toBe("João da Silva");
    expect(extractName("Ana Paula", true)).toBe("Ana Paula");
    expect(extractName("Ana Paula", false)).toBeNull();
    expect(extractName("quanto custa?", true)).toBeNull();
    expect(extractName("botox", true)).toBeNull();
    expect(extractName("11987654321", true)).toBeNull();
  });

  it("preferências de data e período", () => {
    expect(parseSchedulePreference("amanhã à tarde", TODAY)).toEqual({ period: "afternoon", date: "2026-11-03" });
    expect(parseSchedulePreference("sexta de manhã", TODAY)).toEqual({ period: "morning", weekday: 5 });
    expect(parseSchedulePreference("dia 15/11", TODAY)).toEqual({ date: "2026-11-15" });
    expect(parseSchedulePreference("pode ser dia 1", TODAY)).toEqual({ date: "2026-12-01" });
    expect(parseSchedulePreference("qualquer horário", TODAY)).toEqual({});
  });
});

describe("horários disponíveis", () => {
  const now = zonedDateTime(TODAY, "10:00", TZ);
  const base = {
    now,
    timeZone: TZ,
    weeklyHours: [[], [{ start: "09:00", end: "12:00" }], [{ start: "09:00", end: "12:00" }], [], [], [], []],
    professionalIds: ["p1"],
    durationMinutes: 60,
    stepMinutes: 60,
    minNoticeHours: 2,
    maxDaysAhead: 8,
    maxOptions: 4,
    busy: [] as Array<{ professionalId: string; startsAt: Date; endsAt: Date }>,
  };

  it("respeita antecedência mínima, ocupação e o limite por dia", () => {
    const busy = [{ professionalId: "p1", startsAt: zonedDateTime("2026-11-03", "09:00", TZ), endsAt: zonedDateTime("2026-11-03", "10:00", TZ) }];
    const { slots, matchedPreference } = computeAvailableSlots({ ...base, busy });
    expect(matchedPreference).toBe(true);
    // Hoje às 11h fica a menos de 2h de antecedência; terça às 9h está ocupado.
    expect(slots.map((slot) => `${slot.dateKey} ${slot.time}`)).toEqual([
      "2026-11-03 10:00",
      "2026-11-03 11:00",
      "2026-11-09 09:00",
      "2026-11-09 10:00",
    ]);
    expect(formatSlotLabel(slots[0]!)).toBe("Ter, 03/11 às 10:00");
  });

  it("filtra pela preferência e oferece alternativas quando não há horário nela", () => {
    const morningTuesday = computeAvailableSlots({ ...base, preference: { weekday: 2, period: "morning" } });
    expect(morningTuesday.matchedPreference).toBe(true);
    expect(morningTuesday.slots.length).toBeGreaterThan(0);
    expect(morningTuesday.slots.every((slot) => weekdayOf(slot.dateKey) === 2 && slot.time < "12:00")).toBe(true);

    const evening = computeAvailableSlots({ ...base, preference: { period: "evening" } });
    expect(evening.matchedPreference).toBe(false);
    expect(evening.slots.length).toBeGreaterThan(0);
  });

  it("sem profissionais ou horários, nenhuma opção", () => {
    expect(computeAvailableSlots({ ...base, professionalIds: [] }).slots).toEqual([]);
    expect(computeAvailableSlots({ ...base, weeklyHours: [[], [], [], [], [], [], []] }).slots).toEqual([]);
  });
});

const passages: KnowledgePassage[] = [
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
    content: "Rua das Flores, 123. Telefone (11) 3333-4444.",
    keywords: "endereço, localização",
    category: "CLINIC_INFO",
    procedureName: null,
  },
  {
    id: "00000000-0000-7000-8000-000000000003",
    title: "Formas de pagamento",
    content: "Pix e cartão em até 6 vezes.",
    keywords: "pagamento, pix, cartão, parcelamento",
    category: "PRICING",
    procedureName: null,
  },
];

describe("busca na base de conhecimento", () => {
  it("encontra pela pergunta, por sinônimos e por palavras-chave", () => {
    expect(rankPassages("qual o valor da consulta?", passages)[0]?.passage.id).toBe(passages[0]!.id);
    expect(rankPassages("vocês parcelam no cartão?", passages)[0]?.passage.id).toBe(passages[2]!.id);
    expect(rankPassages("qual o endereço de vocês", passages)[0]?.passage.id).toBe(passages[1]!.id);
  });

  it("só considera confiável o que bate com título ou palavras-chave", () => {
    expect(isConfidentMatch(rankPassages("quanto custa a avaliação", passages)[0])).toBe(true);
    expect(isConfidentMatch(rankPassages("vocês fazem harmonização de glúteos?", passages)[0])).toBe(false);
  });
});

describe("checagem das respostas redigidas pelo modelo", () => {
  const sources = [passages[0]!, passages[1]!];

  it("aceita valores e contatos que estão na fonte", () => {
    expect(checkGroundedAnswer("A avaliação custa R$ 150,00 e é abatida depois.", sources)).toEqual({ ok: true });
    expect(checkGroundedAnswer("Fica na Rua das Flores, 123 — telefone (11) 3333-4444.", sources)).toEqual({ ok: true });
  });

  it("bloqueia preço, percentual, telefone ou link sem fonte e falsa identidade", () => {
    expect(checkGroundedAnswer("A avaliação custa R$ 120,00.", sources)).toEqual({ ok: false, reason: "price" });
    expect(checkGroundedAnswer("Hoje temos 20% de desconto.", sources)).toEqual({ ok: false, reason: "percentage" });
    expect(checkGroundedAnswer("Ligue para 11 98888-7777.", sources)).toEqual({ ok: false, reason: "contact" });
    expect(checkGroundedAnswer("Veja em https://exemplo.com/promo", sources)).toEqual({ ok: false, reason: "link" });
    expect(checkGroundedAnswer("Oi, sou a Dra. Daniela!", sources)).toEqual({ ok: false, reason: "identity" });
    expect(checkGroundedAnswer("Custa R$ 150,00.", [])).toEqual({ ok: false, reason: "no_sources" });
  });

  it("entende formatos de valor em reais", () => {
    expect(extractMoneyAmounts("R$ 1.200,50 ou 350 reais ou R$99")).toEqual([120050, 9900, 35000]);
  });
});

describe("configurações e validações", () => {
  it("completa configurações antigas com os padrões e recusa conteúdo inválido", () => {
    const merged = resolveAssistantConfig({ enabled: false, messages: { greeting: "Oi!" } });
    expect(merged.enabled).toBe(false);
    expect(merged.messages.greeting).toBe("Oi!");
    expect(merged.messages.handoff).toBe(DEFAULT_ASSISTANT_CONFIG.messages.handoff);
    expect(resolveAssistantConfig({ booking: { slotStepMinutes: 1 } })).toEqual(DEFAULT_ASSISTANT_CONFIG);
    expect(resolveAssistantConfig(null)).toEqual(DEFAULT_ASSISTANT_CONFIG);
  });

  it("preenche marcadores e remove os vazios sem deixar pontuação solta", () => {
    expect(fillTemplate("Pronto, {nome}! Seu horário é {data} às {hora}.", { nome: "Ana", data: "terça", hora: "10:00" })).toBe(
      "Pronto, Ana! Seu horário é terça às 10:00.",
    );
    expect(fillTemplate("Perfeito, {nome}! Até logo. {horario_equipe}", { nome: "" })).toBe("Perfeito! Até logo.");
  });

  it("modelo: um parâmetro para cada marcador do texto", () => {
    const input = { name: "lembrete_retorno", language: "pt_BR", category: "UTILITY", usage: "RETURN_REMINDER", body: "Olá, {{1}}! Retorno em {{2}}." };
    expect(templateInputSchema.safeParse({ ...input, parameters: ["patient_name", "due_date"] }).success).toBe(true);
    expect(templateInputSchema.safeParse({ ...input, parameters: ["patient_name"] }).success).toBe(false);
    expect(templateInputSchema.safeParse({ ...input, name: "Lembrete Retorno", parameters: ["patient_name", "due_date"] }).success).toBe(false);
  });

  it("regras de acompanhamento: mensagem exige modelo, tarefa exige título, sem duplicadas", () => {
    expect(followUpRulesSchema.safeParse([{ daysBefore: 7, action: "MESSAGE" }]).success).toBe(false);
    expect(followUpRulesSchema.safeParse([{ daysBefore: 0, action: "TASK" }]).success).toBe(false);
    expect(
      followUpRulesSchema.safeParse([
        { daysBefore: 30, action: "MESSAGE", templateId: "0192f0c5-5a8e-7c4e-9a8e-3f1d2b3c4d5e" },
        { daysBefore: 30, action: "MESSAGE", templateId: "0192f0c5-5a8e-7c4e-9a8e-3f1d2b3c4d5e" },
      ]).success,
    ).toBe(false);
    expect(
      followUpRulesSchema.safeParse([
        { daysBefore: 30, action: "MESSAGE", templateId: "0192f0c5-5a8e-7c4e-9a8e-3f1d2b3c4d5e", stepKinds: ["MAINTENANCE"] },
        { daysBefore: 0, action: "TASK", taskTitle: "Ligar para a paciente" },
      ]).success,
    ).toBe(true);
  });

  it("estado do fluxo: conteúdo inválido recomeça; fluxo parado expira mas mantém o que o contato informou", () => {
    const now = new Date("2026-11-02T13:00:00Z");
    expect(readAssistantState({ v: 99 }, now, 24).flow).toBe("idle");
    const stale = readAssistantState(
      { v: 1, flow: "booking", step: "confirm_slot", name: "Ana", updatedAt: "2026-10-30T10:00:00Z" },
      now,
      24,
    );
    expect(stale).toMatchObject({ flow: "idle", step: null, name: "Ana" });
  });
});

describe("webhook: situação dos modelos na Meta", () => {
  it("extrai a atualização e gera chave distinta por momento do evento", () => {
    const payload = webhookPayloadSchema.parse({
      object: "whatsapp_business_account",
      entry: [
        {
          id: "WABA",
          time: 1_790_000_000,
          changes: [
            {
              field: "message_template_status_update",
              value: { event: "APPROVED", message_template_id: 123, message_template_name: "lembrete_retorno", message_template_language: "pt_BR", reason: "NONE" },
            },
          ],
        },
      ],
    });
    const [event] = extractWebhookEvents(payload);
    expect(event).toEqual({
      kind: "template_status",
      name: "lembrete_retorno",
      language: "pt_BR",
      event: "APPROVED",
      reason: "NONE",
      metaTemplateId: "123",
      time: 1_790_000_000,
    });
    expect(webhookEventKey(event!)).toBe("template:123:pt_BR:APPROVED:1790000000");
  });
});
