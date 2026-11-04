import { normalizeText } from "./text";
import type { KnowledgePassage } from "./types";

/**
 * Checagem de segurança das respostas redigidas pelo modelo, ANTES do envio.
 * Garante que a resposta não traz o que não está nas entradas aprovadas usadas
 * como fonte: valores em reais, percentuais, telefones, e-mails e links. Também
 * bloqueia respostas sem fonte e qualquer tentativa de se passar pela Dra. Daniela.
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
  /\b(aqui (e|eh|quem fala e) )(a )?(dra|doutora) daniela\b/,
  /\bsou a daniela\b/,
  /\bsou (a )?(medica|dermatologista|profissional responsavel)\b/,
];

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
