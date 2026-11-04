import type { KnowledgeCategory } from "@/generated/prisma/enums";

import type { DayPeriod } from "./text";

/**
 * Contrato entre o orquestrador e os motores de interpretação (por regras ou
 * Claude). O motor só INTERPRETA a mensagem e, para perguntas informativas,
 * redige uma resposta a partir das entradas aprovadas recebidas. Toda ação
 * (cadastrar lead, agendar, cancelar, descadastrar, encaminhar) é decidida e
 * executada pelo orquestrador, com confirmação explícita do contato.
 */

export const INTENTS = [
  "greeting",
  "services",
  "pricing",
  "schedule",
  "reschedule",
  "cancel_appointment",
  "admin_info",
  "human",
  "opt_out",
  "opt_in",
  "affirm",
  "deny",
  "thanks",
  "other",
] as const;

export type Intent = (typeof INTENTS)[number];

/** Intenções respondidas com a base de conhecimento. */
export const INFORMATIONAL_INTENTS: ReadonlySet<Intent> = new Set(["services", "pricing", "admin_info", "other"]);

export interface KnowledgePassage {
  id: string;
  title: string;
  content: string;
  keywords: string;
  category: KnowledgeCategory;
  procedureName: string | null;
}

export interface HistoryMessage {
  from: "contact" | "clinic";
  text: string;
}

/** O que o assistente perguntou por último (ajuda a interpretar respostas curtas). */
export type Expectation = "name" | "option" | "yes_no" | "preference" | "free_text" | null;

export interface InterpretInput {
  /** Mensagem(ns) ainda sem resposta, com dados pessoais mascarados. */
  text: string;
  /** Mensagens anteriores (mascaradas), da mais antiga para a mais recente. */
  history: HistoryMessage[];
  /** Entradas APROVADAS da base de conhecimento — a única fonte permitida para respostas. */
  passages: KnowledgePassage[];
  expecting: Expectation;
  /** Opções oferecidas na última mensagem (ex.: horários), na ordem numerada. */
  options: string[];
  /** Data de hoje no fuso da clínica (AAAA-MM-DD) e por extenso. */
  today: string;
  todayLabel: string;
  clinicName: string;
  assistantName: string;
}

export interface Interpretation {
  intent: Intent;
  confidence: number;
  entities: {
    name: string | null;
    procedure: string | null;
    period: DayPeriod | null;
    date: string | null;
    weekday: number | null;
    optionNumber: number | null;
  };
  flags: {
    /** Pergunta de saúde/conduta (diagnóstico, medicação, contraindicação…): só a equipe responde. */
    clinical: boolean;
    /** Possível urgência de saúde (reação, dor forte, sangramento…). */
    urgent: boolean;
    wantsHuman: boolean;
  };
  /** Resposta informativa redigida SOMENTE com as entradas recebidas. */
  answer: { found: boolean; text: string; sourceIds: string[] };
}

export interface AssistantModel {
  /** "rules" ou "anthropic:<modelo>" — registrado em cada execução. */
  readonly name: string;
  /**
   * Pior caso de duração de `interpret` (tempo limite × tentativas). A reserva
   * da conversa dura pelo menos isso, para não expirar com a execução ainda em
   * andamento. Ausente: motor local, sem chamada de rede.
   */
  readonly maxLatencyMs?: number;
  interpret(input: InterpretInput): Promise<Interpretation>;
}

/** Falha do motor de interpretação, com mensagem segura (sem conteúdo nem credenciais). */
export class AssistantModelError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(message: string, code: string, retryable: boolean) {
    super(message);
    this.name = "AssistantModelError";
    this.code = code;
    this.retryable = retryable;
  }
}

export function emptyInterpretation(intent: Intent = "other"): Interpretation {
  return {
    intent,
    confidence: 0,
    entities: { name: null, procedure: null, period: null, date: null, weekday: null, optionNumber: null },
    flags: { clinical: false, urgent: false, wantsHuman: false },
    answer: { found: false, text: "", sourceIds: [] },
  };
}
