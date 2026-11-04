import { normalizeText } from "./text";
import type { KnowledgePassage } from "./types";

/**
 * Checagem de segurança das respostas redigidas pelo modelo, ANTES do envio.
 * Garante que a resposta não traz o que não está nas entradas aprovadas usadas
 * como fonte: valores em reais, percentuais, telefones, e-mails e links. Também
 * bloqueia respostas sem fonte e qualquer tentativa de se passar pela profissional da clínica.
 * Falhou: a resposta não é enviada (vira "não sei" + pendência de curadoria).
 */

export type GuardFailure = "empty" | "no_sources" | "price" | "percentage" | "contact" | "link" | "identity" | "too_long";

export type GuardResult = { ok: true } | { ok: false; reason: GuardFailure };

export const MAX_ANSWER_LENGTH = 1200;

/** Valores monetários em centavos: "R$ 1.200,00", "R$350", "350 reais". */
export function extractMoneyAmounts(text: string): number[] {
  const amounts: number[] = [];
  const patterns = [/R\$\s*(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?/gi, /\b(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?\s*reais\b/gi];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const integer = Number(match[1]!.replace(/\./g, ""));
      const cents = match[2] ? Number(match[2].padEnd(2, "0")) : 0;
      amounts.push(integer * 100 + cents);
    }
  }
  return amounts;
}

function extractPercentages(text: string): string[] {
  return [...text.matchAll(/(\d+(?:[.,]\d+)?)\s*%/g)].map((match) => match[1]!.replace(",", "."));
}

/** Sequências com 8+ dígitos (telefones, documentos). */
function extractLongNumbers(text: string): string[] {
  return [...text.matchAll(/(?:\+?\d[\d\s().-]{7,}\d)/g)]
    .map((match) => match[0].replace(/\D/g, ""))
    .filter((digits) => digits.length >= 8);
}

function extractLinks(text: string): string[] {
  const links = [
    ...[...text.matchAll(/\bhttps?:\/\/[^\s)]+/gi)].map((match) => match[0]),
    ...[...text.matchAll(/\bwww\.[^\s)]+/gi)].map((match) => match[0]),
    ...[...text.matchAll(/[\w.+-]+@[\w-]+\.[\w.-]+/g)].map((match) => match[0]),
  ];
  return links.map((link) => link.toLowerCase().replace(/[.,;!?]+$/, ""));
}

const IMPERSONATION = [
  /\bsou (a )?(dra|doutora|dr|doutor)\b/,
  // "Dra." com ou sem ponto (a normalização preserva a pontuação).
  /\b(aqui (e|eh|quem fala e) )(a )?(dra\.?|doutora) daniela\b/,
  // "Você está falando com a Dra." (e não "na avaliação você fala com a Dra.", que é legítimo).
  /\besta falando com a (dra\.?|doutora) daniela\b/,
  /\bsou a daniela\b/,
  /\bsou (a )?(medica|dermatologista|profissional responsavel)\b/,
];

// -----------------------------------------------------------------------------
// IA generativa (motor agente): resposta livre, fatos conferidos
// -----------------------------------------------------------------------------

export type AgentGuardFailure =
  | "too_long"
  | "markdown"
  | "identity"
  | "price"
  | "percentage"
  | "contact"
  | "link"
  | "false_completion"
  | "guarantee"
  | "repetition";

export type AgentGuardResult = { ok: true } | { ok: false; reason: AgentGuardFailure; detail: string };

/** Ações concluídas NESTE turno pelo servidor (as únicas que a resposta pode dar como feitas). */
export interface CompletedActions {
  booked: boolean;
  rescheduled: boolean;
  cancelled: boolean;
}

/** "Agendei", "foi remarcado", "ficou cancelado"… — afirmações de algo já concluído. */
const COMPLETION_CLAIMS: Array<{ pattern: RegExp; action: keyof CompletedActions }> = [
  { pattern: /\b(agendei|marquei|reservei|(foi|ficou|esta|ja esta) (agendad|marcad|reservad)[oa])\b/, action: "booked" },
  { pattern: /\b(remarquei|(foi|ficou|esta|ja esta) remarcad[oa])\b/, action: "rescheduled" },
  { pattern: /\b(cancelei|desmarquei|(foi|ficou|esta|ja esta) (cancelad|desmarcad)[oa])\b/, action: "cancelled" },
];

const GUARANTEES =
  /\b(resultados? (e |eh |sao |fica |ficam |sera |serao )?garantid\w*|garant\w+ (o |os |um |seu |seus )?resultados?|sem (nenhum )?risco|100% (seguro|natural|garantido)|nao (tem|ha) (nenhum )?risco)\b/;

const MARKDOWN = /(\*\*[^*]+\*\*|^#{1,6}\s|^\s*[-*]\s+\S.*\n\s*[-*]\s+\S|\[[^\]]+\]\([^)]+\))/m;

/**
 * Checagem das respostas da IA generativa ANTES do envio. Valores em reais,
 * percentuais, telefones, e-mails e links só passam se aparecem nos fatos que
 * o modelo recebeu neste turno (base aprovada, resultados das ferramentas,
 * contexto da clínica). Também bloqueia: dizer que agendou/remarcou/cancelou
 * sem o servidor ter concluído a ação, prometer resultado, passar-se pela
 * profissional, repetir a mensagem anterior, markdown e textos longos demais.
 * Falhou: o modelo recebe o motivo e reescreve uma vez; persistindo, a
 * resposta não é enviada.
 */
export function checkAgentReply(
  reply: string,
  context: { facts: string; completed: CompletedActions; maxChars: number; previousReplies: string[] },
): AgentGuardResult {
  const text = reply.trim();
  if (!text) return { ok: true };
  if (text.length > context.maxChars) {
    return { ok: false, reason: "too_long", detail: `A resposta tem ${text.length} caracteres; o limite é ${context.maxChars}.` };
  }
  if (MARKDOWN.test(text)) {
    return { ok: false, reason: "markdown", detail: "Use texto simples de WhatsApp, sem negrito com **, títulos, listas com marcadores ou links em markdown." };
  }

  const normalized = normalizeText(text);
  if (IMPERSONATION.some((pattern) => pattern.test(normalized))) {
    return { ok: false, reason: "identity", detail: "Você é a assistente virtual da clínica, não a profissional nem uma pessoa da equipe." };
  }

  const allowedAmounts = new Set(extractMoneyAmounts(context.facts));
  const unknownAmount = extractMoneyAmounts(text).find((amount) => !allowedAmounts.has(amount));
  if (unknownAmount !== undefined) {
    return { ok: false, reason: "price", detail: "A resposta cita um valor que não está na base aprovada nem nos resultados das ferramentas. Não informe valores sem fonte." };
  }
  const allowedPercentages = new Set(extractPercentages(context.facts));
  if (extractPercentages(text).some((value) => !allowedPercentages.has(value))) {
    return { ok: false, reason: "percentage", detail: "A resposta cita um percentual sem fonte aprovada." };
  }
  const allowedNumbers = new Set(extractLongNumbers(context.facts));
  if (extractLongNumbers(text).some((digits) => !allowedNumbers.has(digits))) {
    return { ok: false, reason: "contact", detail: "A resposta cita um telefone ou número que não está nas informações aprovadas." };
  }
  const factsLower = context.facts.toLowerCase();
  if (extractLinks(text).some((link) => !factsLower.includes(link))) {
    return { ok: false, reason: "link", detail: "A resposta cita um link ou e-mail que não está nas informações aprovadas." };
  }

  for (const claim of COMPLETION_CLAIMS) {
    if (claim.pattern.test(normalized) && !context.completed[claim.action]) {
      return {
        ok: false,
        reason: "false_completion",
        detail: "A resposta dá como concluída uma ação que o sistema não concluiu neste turno. Só diga que algo foi agendado, remarcado ou cancelado depois que confirm_pending_action retornar \"concluido\".",
      };
    }
  }
  if (GUARANTEES.test(normalized)) {
    return { ok: false, reason: "guarantee", detail: "Não prometa resultados nem ausência de riscos." };
  }
  if (context.previousReplies.some((previous) => normalizeText(previous) === normalized)) {
    return { ok: false, reason: "repetition", detail: "A resposta repete exatamente uma mensagem anterior. Responda ao que a pessoa disse agora, com outras palavras." };
  }
  return { ok: true };
}

export function checkGroundedAnswer(answer: string, sources: KnowledgePassage[]): GuardResult {
  const text = answer.trim();
  if (!text) return { ok: false, reason: "empty" };
  if (sources.length === 0) return { ok: false, reason: "no_sources" };
  if (text.length > MAX_ANSWER_LENGTH) return { ok: false, reason: "too_long" };

  const normalized = normalizeText(text);
  if (IMPERSONATION.some((pattern) => pattern.test(normalized))) return { ok: false, reason: "identity" };

  const sourceText = sources.map((source) => `${source.title}\n${source.content}`).join("\n");

  const allowedAmounts = new Set(extractMoneyAmounts(sourceText));
  if (extractMoneyAmounts(text).some((amount) => !allowedAmounts.has(amount))) return { ok: false, reason: "price" };

  const allowedPercentages = new Set(extractPercentages(sourceText));
  if (extractPercentages(text).some((value) => !allowedPercentages.has(value))) return { ok: false, reason: "percentage" };

  const allowedNumbers = new Set(extractLongNumbers(sourceText));
  if (extractLongNumbers(text).some((digits) => !allowedNumbers.has(digits))) return { ok: false, reason: "contact" };

  const sourceLower = sourceText.toLowerCase();
  if (extractLinks(text).some((link) => !sourceLower.includes(link))) return { ok: false, reason: "link" };

  return { ok: true };
}
