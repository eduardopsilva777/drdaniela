import type { KnowledgeCategory } from "@/generated/prisma/enums";

import { searchTerms } from "./text";
import type { Intent, KnowledgePassage } from "./types";

/**
 * Recuperação na base de conhecimento (RAG lexical, função pura): pontua as
 * entradas aprovadas pelos termos da pergunta — título e palavras-chave pesam
 * mais que o texto — com sinônimos comuns de atendimento. A equipe melhora a
 * recuperação cadastrando sinônimos em "palavras-chave" de cada entrada.
 */

/** Sinônimos do vocabulário de atendimento (já normalizados e com radical). */
const SYNONYMS: Record<string, string[]> = {
  preco: ["valor", "custo", "custa", "quanto", "investimento"],
  valor: ["preco", "custo", "custa", "investimento"],
  custa: ["preco", "valor"],
  quanto: ["preco", "valor"],
  endereco: ["localizacao", "onde", "chegar", "local"],
  onde: ["endereco", "localizacao"],
  localizacao: ["endereco", "onde"],
  horario: ["funcionamento", "abre", "fecha", "atendimento"],
  funcionamento: ["horario", "abre", "fecha"],
  pagamento: ["pix", "cartao", "parcela", "parcelamento", "dinheiro", "pagar"],
  pagar: ["pagamento", "pix", "cartao"],
  parcela: ["parcelamento", "pagamento", "cartao"],
  parcelamento: ["parcela", "pagamento"],
  cartao: ["pagamento", "parcela", "credito", "debito"],
  pix: ["pagamento"],
  estacionamento: ["vaga", "estacionar", "carro"],
  cancelamento: ["cancelar", "desmarcar", "falta", "atraso"],
  atraso: ["atrasar", "tolerancia", "cancelamento"],
  avaliacao: ["consulta", "primeira"],
  consulta: ["avaliacao"],
  preparo: ["preparacao", "antes", "orientacao"],
  toxina: ["botox", "botulinica"],
  botox: ["toxina", "botulinica"],
  preenchimento: ["acido", "hialuronico"],
};

const FIELD_WEIGHT = { title: 3, keywords: 3, procedure: 2, content: 1 } as const;

/** Categorias favorecidas conforme a intenção identificada. */
const INTENT_CATEGORIES: Partial<Record<Intent, KnowledgeCategory[]>> = {
  pricing: ["PRICING"],
  services: ["SERVICE"],
  admin_info: ["CLINIC_INFO", "POLICY"],
  schedule: ["SCHEDULING"],
};

export interface ScoredPassage {
  passage: KnowledgePassage;
  score: number;
  /** Fração dos termos da pergunta encontrados na entrada. */
  coverage: number;
  /** Ao menos um termo da pergunta no título ou nas palavras-chave. */
  titleOrKeywordHit: boolean;
}

interface IndexedPassage {
  passage: KnowledgePassage;
  title: Set<string>;
  keywords: Set<string>;
  procedure: Set<string>;
  content: Set<string>;
}

function index(passage: KnowledgePassage): IndexedPassage {
  return {
    passage,
    title: new Set(searchTerms(passage.title)),
    keywords: new Set(passage.keywords.split(/[,;\n]/).flatMap((keyword) => searchTerms(keyword))),
    procedure: new Set(passage.procedureName ? searchTerms(passage.procedureName) : []),
    content: new Set(searchTerms(passage.content)),
  };
}

function fieldScore(entry: IndexedPassage, term: string): number {
  let score = 0;
  if (entry.title.has(term)) score += FIELD_WEIGHT.title;
  if (entry.keywords.has(term)) score += FIELD_WEIGHT.keywords;
  if (entry.procedure.has(term)) score += FIELD_WEIGHT.procedure;
  if (entry.content.has(term)) score += FIELD_WEIGHT.content;
  return score;
}

export function rankPassages(query: string, passages: KnowledgePassage[], intent?: Intent): ScoredPassage[] {
  const terms = searchTerms(query);
  if (terms.length === 0 || passages.length === 0) return [];

  const weighted = new Map<string, number>();
  for (const term of terms) weighted.set(term, 1);
  for (const term of terms) {
    for (const synonym of SYNONYMS[term] ?? []) {
      if (!weighted.has(synonym)) weighted.set(synonym, 0.5);
    }
  }

  const indexed = passages.map(index);
  const documentFrequency = new Map<string, number>();
  for (const term of weighted.keys()) {
    documentFrequency.set(term, indexed.filter((entry) => fieldScore(entry, term) > 0).length);
  }
  const total = indexed.length;
  const boosted = new Set(intent ? (INTENT_CATEGORIES[intent] ?? []) : []);

  const scored: ScoredPassage[] = [];
  for (const entry of indexed) {
    let score = 0;
    let matchedOriginal = 0;
    let titleOrKeywordHit = false;
    for (const [term, weight] of weighted) {
      const field = fieldScore(entry, term);
      if (field === 0) continue;
      const df = documentFrequency.get(term) ?? 0;
      const idf = Math.log(1 + (total - df + 0.5) / (df + 0.5));
      score += weight * idf * field;
      if (weight === 1) {
        matchedOriginal += 1;
        if (entry.title.has(term) || entry.keywords.has(term)) titleOrKeywordHit = true;
      }
    }
    if (score <= 0) continue;
    if (boosted.has(entry.passage.category)) score *= 1.3;
    scored.push({ passage: entry.passage, score, coverage: matchedOriginal / terms.length, titleOrKeywordHit });
  }
  return scored.sort((a, b) => b.score - a.score);
}

/**
 * A melhor entrada responde com segurança à pergunta? Usado pelo motor por
 * regras (que devolve o texto aprovado sem reescrever): exige termo da pergunta
 * no título/palavras-chave e boa cobertura.
 */
export function isConfidentMatch(match: ScoredPassage | undefined): boolean {
  return Boolean(match && match.titleOrKeywordHit && match.coverage >= 0.5 && match.score >= 1.5);
}
