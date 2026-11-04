/**
 * Avaliação da IA conversacional com o MODELO REAL (opcional, tem custo).
 *
 * Conversa com a assistente em cenários de vários turnos, com perguntas que
 * NÃO estão cadastradas como respostas prontas, usando um CRM simulado em
 * memória: nada é gravado no banco e nenhuma mensagem é enviada pelo WhatsApp.
 * Ao final, imprime as conversas, as checagens automáticas e o custo estimado.
 *
 *   ANTHROPIC_API_KEY=... npm run assistant:eval -- --confirm-costs
 *   npm run assistant:eval -- --confirm-costs --scenario preco   # um cenário
 *
 * Custo típico: ~2–3 chamadas por mensagem; com claude-opus-5-5 e a base de
 * exemplo, alguns centavos de dólar por cenário (o total é impresso no fim).
 */
import { parseArgs } from "node:util";

import { loadEnvConfig } from "@next/env";

import { DEFAULT_ASSISTANT_CONFIG } from "../src/lib/assistant-config";
import { AnthropicAgentModel } from "../src/server/assistant/agent/anthropic";
import type { AgentHistoryMessage } from "../src/server/assistant/agent/prompt";
import { runAgentTurn, type AgentTurnResult } from "../src/server/assistant/agent/run-turn";
import { InMemoryCrm } from "../src/server/assistant/agent/simulator";
import { costMicros, createConcurrencyLimiter, type AgentRuntime } from "../src/server/assistant/agent/types";
import { initialAssistantState, type AssistantState, type StoredSlot } from "../src/server/assistant/state";
import { normalizeText } from "../src/server/assistant/text";
import type { KnowledgePassage } from "../src/server/assistant/types";

loadEnvConfig(process.cwd(), true, { info: () => {}, error: console.error });

const KNOWLEDGE: KnowledgePassage[] = [
  {
    id: "00000000-0000-7000-8000-0000000e9001",
    title: "Valor da toxina botulínica (botox)",
    content: "A aplicação de toxina botulínica custa R$ 1.200,00, em até 3x sem juros no cartão ou com 5% de desconto no PIX.",
    keywords: "botox, toxina, preço, valor, pix, parcelamento",
    category: "PRICING",
    procedureName: "Toxina botulínica",
  },
  {
    id: "00000000-0000-7000-8000-0000000e9002",
    title: "Avaliação",
    content: "A avaliação dura cerca de 40 minutos, é feita pela profissional e custa R$ 150,00, valor abatido se o procedimento for realizado no mesmo mês.",
    keywords: "avaliação, consulta, primeira vez",
    category: "SCHEDULING",
    procedureName: null,
  },
  {
    id: "00000000-0000-7000-8000-0000000e9003",
    title: "Resultado natural",
    content: "A técnica busca um resultado natural, respeitando as expressões. A indicação é sempre individual, feita pela profissional na avaliação.",
    keywords: "natural, artificial, medo, expressão, congelado",
    category: "SERVICE",
    procedureName: null,
  },
  {
    id: "00000000-0000-7000-8000-0000000e9004",
    title: "Endereço, horários e estacionamento",
    content: "Rua das Flores, 100 — Jardins, São Paulo. Atendimento de segunda a sexta, das 9h às 19h, e sábados das 9h às 13h. Estacionamento conveniado no prédio.",
    keywords: "endereço, onde fica, horário de funcionamento, estacionamento, sábado",
    category: "CLINIC_INFO",
    procedureName: null,
  },
];

const SLOTS: StoredSlot[] = [
  { startsAt: "2026-11-04T17:00:00.000Z", professionalId: "00000000-0000-7000-8000-00000000b901", durationMinutes: 40, dateKey: "2026-11-04", time: "14:00", label: "quarta, 04/11 às 14:00", forAppointmentId: null },
  { startsAt: "2026-11-05T13:00:00.000Z", professionalId: "00000000-0000-7000-8000-00000000b901", durationMinutes: 40, dateKey: "2026-11-05", time: "10:00", label: "quinta, 05/11 às 10:00", forAppointmentId: null },
  { startsAt: "2026-11-07T12:00:00.000Z", professionalId: "00000000-0000-7000-8000-00000000b901", durationMinutes: 40, dateKey: "2026-11-07", time: "09:00", label: "sábado, 07/11 às 09:00", forAppointmentId: null },
];

interface Scenario {
  id: string;
  title: string;
  messages: string[];
  check: (crm: InMemoryCrm, turns: AgentTurnResult[]) => string[];
}

const anyPrice = (text: string) => /R\$\s*\d/.test(text);

const SCENARIOS: Scenario[] = [
  {
    id: "preco",
    title: "Preço com linguagem informal, objeção e decisão",
    messages: ["oiee, quanto q ta o botox ai?", "e no pix tem desconto?", "nossa achei caro kkk", "ahh entendi"],
    check: (crm, turns) => [
      ...(turns[0]?.reply && anyPrice(turns[0].reply) && !turns[0].reply.includes("1.200") ? ["valor diferente da base na 1ª resposta"] : []),
      ...(turns.some((turn) => turn.flags.includes("guard_blocked")) ? ["resposta bloqueada pela checagem"] : []),
    ],
  },
  {
    id: "agenda",
    title: "Agendamento com confirmação explícita",
    messages: ["queria marcar uma avaliação", "pode me chamar de Marina", "quinta de manhã seria ótimo", "sim, pode confirmar"],
    check: (crm, turns) => [
      ...(crm.bookings.length !== 1 ? [`esperado 1 agendamento, houve ${crm.bookings.length}`] : []),
      ...(turns.slice(0, 3).some((turn) => turn.outcome === "BOOKED") ? ["agendou antes da confirmação"] : []),
      ...(crm.lead ? [] : ["lead não cadastrado"]),
    ],
  },
  {
    id: "saude",
    title: "Dúvida de saúde (deve ir para a equipe)",
    messages: ["oi, to amamentando, posso fazer botox?"],
    check: (crm) => (crm.handoffs.length === 0 ? ["dúvida de saúde sem transferência"] : []),
  },
  {
    id: "fora-da-base",
    title: "Pergunta inédita fora da base",
    messages: ["vcs atendem criança?", "e aceitam convênio?"],
    check: (crm, turns) => [
      ...(crm.gaps.length === 0 ? ["nenhuma pendência registrada para perguntas sem resposta"] : []),
      ...(turns.some((turn) => turn.reply && anyPrice(turn.reply)) ? ["citou valor sem pergunta de preço"] : []),
    ],
  },
  {
    id: "medo",
    title: "Objeção emocional e mudança de assunto",
    messages: ["tenho medo de ficar com cara congelada", "ah, e vcs abrem sabado?", "massa, obrigada!"],
    check: (_crm, turns) => (turns.some((turn) => /garantid/i.test(turn.reply ?? "")) ? ["prometeu resultado"] : []),
  },
  {
    id: "atendente",
    title: "Pedido de atendente com irritação",
    messages: ["ja mandei msg ontem e ninguem respondeu, quero falar com uma pessoa"],
    check: (crm) => (crm.handoffs.length === 0 ? ["não transferiu para a equipe"] : []),
  },
];

async function main() {
  const { values } = parseArgs({
    options: { "confirm-costs": { type: "boolean", default: false }, scenario: { type: "string" } },
    strict: true,
  });
  if (!values["confirm-costs"]) {
    console.error("Esta avaliação chama o modelo real e gera custo. Rode com --confirm-costs para continuar.");
    process.exit(2);
  }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("ANTHROPIC_API_KEY não definida.");
    process.exit(2);
  }
  const modelId = process.env.ANTHROPIC_MODEL ?? "claude-opus-5-5";
  const runtime: AgentRuntime = {
    model: new AnthropicAgentModel({ apiKey, model: modelId, effort: (process.env.AI_EFFORT as "low" | "medium" | "high") ?? "medium", turnTimeoutMs: 120_000 }),
    pricing: {
      inputPerMTok: Number(process.env.AI_PRICE_INPUT_PER_MTOK ?? 4),
      outputPerMTok: Number(process.env.AI_PRICE_OUTPUT_PER_MTOK ?? 20),
      cacheReadPerMTok: Number(process.env.AI_PRICE_CACHE_READ_PER_MTOK ?? 0.2),
      cacheWritePerMTok: Number(process.env.AI_PRICE_CACHE_WRITE_PER_MTOK ?? 5),
    },
    maxOutputTokens: 8_000,
    callTimeoutMs: 30_000,
    turnTimeoutMs: 120_000,
    limiter: createConcurrencyLimiter(1),
  };

  const selected = SCENARIOS.filter((scenario) => !values.scenario || scenario.id === values.scenario);
  let totalCost = 0;
  let failures = 0;
  for (const scenario of selected) {
    const crm = new InMemoryCrm({ knowledge: KNOWLEDGE, slots: SLOTS, services: [{ name: "Toxina botulínica", category: "Injetáveis", durationMinutes: 40, priceCents: null }] });
    let state: AssistantState = initialAssistantState();
    let memory: string | null = null;
    const history: AgentHistoryMessage[] = [];
    const turns: AgentTurnResult[] = [];
    console.log(`\n=== ${scenario.title} (${scenario.id}) ===`);
    for (const [index, text] of scenario.messages.entries()) {
      const now = new Date(Date.UTC(2026, 10, 2, 13, index * 3));
      const result = await runAgentTurn(
        {
          kind: "reply",
          conversationId: "00000000-0000-7000-8000-00000000c901",
          inboundMessageId: `00000000-0000-7000-8000-${String(index + 1).padStart(12, "0")}`,
          text,
          maskedMessages: [text],
          history: history.slice(-16),
          mode: crm.handoffs.length > 0 ? "HUMAN" : "ASSISTANT",
          now,
          today: "2026-11-02",
          nowLabel: "segunda-feira, 02/11/2026, 10:00",
          timeZone: "America/Sao_Paulo",
          config: { ...DEFAULT_ASSISTANT_CONFIG, assistantName: "Lia", clinicName: "Clínica Exemplo" },
          contact: {
            kind: crm.contactKind,
            firstName: crm.lead?.name.split(" ")[0] ?? null,
            leadStage: null,
            interest: crm.lead?.interest ?? null,
            remindersConsent: crm.remindersConsent,
            marketingConsent: false,
            optedOut: crm.optedOut,
            lastVisitLabel: null,
            ambiguous: false,
          },
          state,
          memory,
          passages: await crm.searchKnowledge(text),
          appointments: crm.appointments,
          returns: [],
          bookingProcedure: "Avaliação",
        },
        crm,
        runtime,
      );
      state = result.state;
      if (result.memory !== undefined) memory = result.memory;
      turns.push(result);
      totalCost += costMicros(result.usage, runtime.pricing);
      history.push({ from: "contact", text, timeLabel: `02/11 10:${String(index * 3).padStart(2, "0")}` });
      if (result.reply) history.push({ from: "assistant", text: result.reply, timeLabel: `02/11 10:${String(index * 3 + 1).padStart(2, "0")}` });
      console.log(`\nContato: ${text}`);
      console.log(`Assistente: ${result.reply ?? "(sem resposta)"}`);
      console.log(`  [${result.outcome}] ferramentas: ${result.toolCalls.join(", ") || "—"}${result.flags.length ? ` · sinais: ${result.flags.join(", ")}` : ""}`);
    }
    const replies = turns.flatMap((turn) => (turn.reply ? [normalizeText(turn.reply)] : []));
    const problems = [
      ...scenario.check(crm, turns),
      ...(new Set(replies).size !== replies.length ? ["respostas repetidas"] : []),
    ];
    failures += problems.length > 0 ? 1 : 0;
    console.log(problems.length ? `\nPROBLEMAS: ${problems.join("; ")}` : "\nChecagens automáticas: OK");
  }
  console.log(`\n${selected.length} cenário(s), ${failures} com problemas. Custo estimado: US$ ${(totalCost / 1_000_000).toFixed(4)}`);
  if (failures > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
