import { addDaysToKey, isDateKey, weekdayOf } from "@/lib/datetime";

/**
 * Tratamento de texto das mensagens (funções puras, sem banco): normalização,
 * palavras-chave de descadastro, sim/não, escolha de opção, nome e preferências
 * de data. Usado pelo motor por regras e pelo orquestrador — decisões que não
 * podem depender de um modelo de linguagem.
 */

/** Minúsculas, sem acentos e sem pontuação supérflua; espaços colapsados. */
export function normalizeText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s$%/:,.-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Normalização sem pontuação alguma — para comparar mensagens inteiras. */
function bare(text: string): string {
  return normalizeText(text).replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}

const STOPWORDS = new Set(
  (
    "a o as os um uma uns umas de da do das dos e em no na nos nas ao aos para pra pro por com sem que " +
    "qual quais quando como se sua seu suas seus me minha meu mim te ti voce voces vc vcs eu ela ele " +
    "isso isto esse essa este esta tem ter tenho gostaria queria quero saber sobre mais muito ja ou " +
    "oi ola bom boa dia tarde noite favor por obrigado obrigada tudo bem ai la aqui so tambem nao sim " +
    "pode posso poderia vou vai e eh sao ser estar esta estou fica ficar faz fazer"
  ).split(" "),
);

/** Radical simples (plural e terminações comuns) para a busca na base de conhecimento. */
export function stem(token: string): string {
  if (token.length <= 3) return token;
  if (token.endsWith("coes")) return `${token.slice(0, -4)}cao`;
  if (token.endsWith("oes") || token.endsWith("aes")) return `${token.slice(0, -3)}ao`;
  if (token.endsWith("res") || token.endsWith("zes") || token.endsWith("ses")) return token.slice(0, -2);
  if (token.endsWith("is") && token.length > 5) return `${token.slice(0, -2)}l`;
  if (token.endsWith("s")) return token.slice(0, -1);
  return token;
}

/** Termos de busca: sem palavras vazias, com radical e sem repetição. */
export function searchTerms(text: string): string[] {
  const tokens = normalizeText(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length >= 2 && !STOPWORDS.has(token));
  return [...new Set(tokens.map(stem))];
}

// -----------------------------------------------------------------------------
// Consentimento: descadastro e recadastro
// -----------------------------------------------------------------------------

/** Mensagens inteiras que pedem para não receber mais mensagens. */
const OPT_OUT_MESSAGES = new Set([
  "parar",
  "pare",
  "para",
  "sair",
  "stop",
  "descadastrar",
  "descadastre",
  "descadastro",
  "remover",
  "cancelar inscricao",
  "unsubscribe",
  "nao quero mais",
]);

const OPT_OUT_PHRASES = [
  /\bnao (quero|desejo|gostaria de) (mais )?receber\b/,
  /\b(parar|pare|parem) de (me )?(mandar|enviar|receber)\b/,
  /\bme (tire|tira|tirem|remova|remove|removam|exclua|excluam) (da|dessa|desta) lista\b/,
  /\bnao me (mande|mandem|envie|enviem) mais\b/,
  /\bnao (mande|mandem|envie|enviem) mais (mensagens?|nada)\b/,
];

const OPT_IN_MESSAGES = new Set(["voltar", "quero voltar a receber", "quero receber", "voltar a receber", "reativar"]);

export type ConsentKeyword = "opt_out" | "opt_in" | "ambiguous_cancel";

/**
 * Palavras-chave de consentimento. "CANCELAR" sozinho é ambíguo (cancelar
 * agendamento ou mensagens): o orquestrador pergunta antes de agir quando há
 * agendamento futuro.
 */
export function detectConsentKeyword(text: string): ConsentKeyword | null {
  const message = bare(text);
  if (!message) return null;
  if (message === "cancelar" || message === "cancela") return "ambiguous_cancel";
  if (OPT_OUT_MESSAGES.has(message)) return "opt_out";
  if (OPT_IN_MESSAGES.has(message)) return "opt_in";
  if (OPT_OUT_PHRASES.some((pattern) => pattern.test(message))) return "opt_out";
  return null;
}

// -----------------------------------------------------------------------------
// Sim / não / número de opção
// -----------------------------------------------------------------------------

const YES = new Set([
  "sim",
  "s",
  "ss",
  "sim sim",
  "claro",
  "pode",
  "pode sim",
  "pode ser",
  "confirmo",
  "confirmar",
  "confirmado",
  "confirma",
  "isso",
  "isso mesmo",
  "ok",
  "okay",
  "certo",
  "perfeito",
  "quero",
  "quero sim",
  "com certeza",
  "beleza",
  "fechado",
  "sim por favor",
  "sim pode",
  "sim quero",
  "sim confirmo",
  "aceito",
]);

const NO = new Set([
  "nao",
  "n",
  "nao obrigado",
  "nao obrigada",
  "negativo",
  "nao quero",
  "prefiro nao",
  "agora nao",
  "nenhum",
  "nenhuma",
  "nenhum desses",
  "nenhuma dessas",
  "outro",
  "outra",
  "outro horario",
  "outros horarios",
]);

/** true = sim, false = não, null = não é uma resposta de sim/não. */
export function parseYesNo(text: string): boolean | null {
  if (/^(👍|✅|👌)+$/u.test(text.trim())) return true;
  const message = bare(text);
  if (!message) return null;
  if (YES.has(message) || /^sim\b/.test(message)) return true;
  if (NO.has(message) || /^nao\b/.test(message)) return false;
  return null;
}

/** Ressalvas que tornam uma resposta "sim" condicional ou duvidosa. */
const CONFIRMATION_BLOCKERS =
  /\b(nao|nem|mas|porem|entretanto|contudo|so se|somente se|desde que|caso|talvez|acho que|sera|depois|espera|perai|calma|outro|outra|outros|outras|mudar|muda|trocar|troca|diferente)\b/;

const CONFIRMATION_SIGNALS =
  /\b(sim|claro|pode|confirm\w*|fechado|combinado|perfeito|isso|exato|certo|ok|okay|beleza|blz|bora|show|otimo|aceito|quero|marca|marque|agenda|agende|remarca|remarque|cancela|cancele|com certeza)\b/;

/**
 * Confirmação explícita do contato para uma ação importante (agendar, remarcar,
 * cancelar). Mais tolerante que `parseYesNo` com frases naturais ("pode marcar",
 * "confirmo sim, obrigada"), mas recusa qualquer ressalva ("sim, mas…", "pode
 * ser, só se for de manhã"), pergunta ou mensagem longa: na dúvida, NÃO é
 * confirmação — a IA pergunta de novo.
 */
export function isExplicitConfirmation(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || trimmed.includes("?")) return false;
  if (/^(👍|✅|👌|🙏|😊|🥰|❤️|♥️)+$/u.test(trimmed.replace(/\s+/g, ""))) return true;
  const message = bare(trimmed);
  if (!message || message.length > 120) return false;
  if (CONFIRMATION_BLOCKERS.test(message)) return false;
  return CONFIRMATION_SIGNALS.test(message);
}

const ORDINALS: Record<string, number> = { primeira: 1, primeiro: 1, ultima: -1, ultimo: -1 };

/** Número da opção escolhida ("2", "opção 2", "a primeira"); null se não for uma escolha. */
export function parseOptionNumber(text: string, optionCount: number): number | null {
  const message = bare(text);
  const match = /^(?:(?:a |o )?op(?:cao|ção)? ?)?(\d{1,2})(?: ?(?:opcao|por favor|pf))?$/.exec(message);
  let value: number | null = match ? Number(match[1]) : null;
  if (value === null) {
    const ordinal = /^(?:a |o )?(primeira|primeiro|ultima|ultimo)(?: opcao)?$/.exec(message);
    if (ordinal) value = ORDINALS[ordinal[1]!]! === -1 ? optionCount : 1;
  }
  if (value === null || value < 1 || value > optionCount) return null;
  return value;
}

// -----------------------------------------------------------------------------
// Nome
// -----------------------------------------------------------------------------

const NAME_INTRO = /(?:meu nome (?:e|eh)|me chamo|pode me chamar de|aqui (?:e|eh) (?:a |o )?|sou (?:a |o ))\s*([\p{L}' -]{2,60})/u;

const NOT_A_NAME = new Set([
  ...STOPWORDS,
  "agendar",
  "preco",
  "valor",
  "botox",
  "consulta",
  "avaliacao",
  "horario",
  "quanto",
  "custa",
  "ajuda",
  "duvida",
  "informacao",
  "paciente",
  "cliente",
  "parar",
  "sair",
  "cancelar",
  "remarcar",
]);

function titleCase(value: string): string {
  return value
    .toLocaleLowerCase("pt-BR")
    .split(/\s+/)
    .map((part) => (["da", "de", "do", "das", "dos", "e"].includes(part) ? part : part.charAt(0).toLocaleUpperCase("pt-BR") + part.slice(1)))
    .join(" ");
}

function cleanName(candidate: string): string | null {
  const words = candidate
    .replace(/[^\p{L}' -]/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 4);
  if (words.length === 0) return null;
  const normalized = words.map((word) => normalizeText(word));
  if (normalized.every((word) => NOT_A_NAME.has(word))) return null;
  if (NOT_A_NAME.has(normalized[0]!)) return null;
  const name = titleCase(words.join(" ")).slice(0, 60).trim();
  return name.length >= 2 ? name : null;
}

/**
 * Extrai o nome informado. Com `expectingName` (o assistente acabou de perguntar
 * o nome), aceita uma resposta curta só com letras; caso contrário, só frases
 * explícitas ("meu nome é…", "me chamo…").
 */
export function extractName(text: string, expectingName: boolean): string | null {
  const trimmed = text.trim();
  const intro = NAME_INTRO.exec(normalizeText(trimmed));
  if (intro) {
    // Recupera a grafia original (com acentos) na mesma posição aproximada.
    const original = trimmed.slice(trimmed.length - intro[1]!.length);
    return cleanName(/^[\p{L}' -]+$/u.test(original) ? original : intro[1]!);
  }
  if (!expectingName) return null;
  if (trimmed.length > 60 || /[?\d@]/.test(trimmed)) return null;
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 5) return null;
  if (!/^[\p{L}' .-]+$/u.test(trimmed)) return null;
  return cleanName(trimmed);
}

// -----------------------------------------------------------------------------
// Preferências de data e período
// -----------------------------------------------------------------------------

export type DayPeriod = "morning" | "afternoon" | "evening";

export const PERIOD_LABELS: Record<DayPeriod, string> = { morning: "manhã", afternoon: "tarde", evening: "noite" };

const WEEKDAYS: Array<[RegExp, number]> = [
  [/\bdomingo\b/, 0],
  [/\bsegunda(?:-feira| feira)?\b/, 1],
  [/\bterca(?:-feira| feira)?\b/, 2],
  [/\bquarta(?:-feira| feira)?\b/, 3],
  [/\bquinta(?:-feira| feira)?\b/, 4],
  [/\bsexta(?:-feira| feira)?\b/, 5],
  [/\bsabado\b/, 6],
];

export interface SchedulePreference {
  period?: DayPeriod;
  /** Data específica (AAAA-MM-DD, no fuso da clínica). */
  date?: string;
  /** Dia da semana preferido (0 = domingo). */
  weekday?: number;
}

/** Interpreta "amanhã à tarde", "sexta de manhã", "dia 12/11", "15/11 à noite"… */
export function parseSchedulePreference(text: string, today: string): SchedulePreference {
  const message = normalizeText(text);
  const preference: SchedulePreference = {};

  if (/\b(manha|cedo|de manha)\b/.test(message)) preference.period = "morning";
  else if (/\b(tarde|depois do almoco)\b/.test(message)) preference.period = "afternoon";
  else if (/\b(noite|a noite|fim do dia|final do dia)\b/.test(message)) preference.period = "evening";

  if (/\bdepois de amanha\b/.test(message)) preference.date = addDaysToKey(today, 2);
  else if (/\bamanha\b/.test(message)) preference.date = addDaysToKey(today, 1);
  else if (/\bhoje\b/.test(message)) preference.date = today;

  const dayMonth = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/.exec(message);
  if (!preference.date && dayMonth) {
    const day = Number(dayMonth[1]);
    const month = Number(dayMonth[2]);
    let year = dayMonth[3] ? Number(dayMonth[3].length === 2 ? `20${dayMonth[3]}` : dayMonth[3]) : Number(today.slice(0, 4));
    let key = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if (!dayMonth[3] && isDateKey(key) && key < today) {
      year += 1;
      key = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
    if (isDateKey(key)) preference.date = key;
  }

  if (!preference.date) {
    const dayOnly = /\bdia (\d{1,2})\b/.exec(message);
    if (dayOnly) {
      const day = Number(dayOnly[1]);
      const [year, month] = today.split("-").map(Number) as [number, number];
      let key = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      if (isDateKey(key) && key < today) {
        const nextMonth = month === 12 ? 1 : month + 1;
        const nextYear = month === 12 ? year + 1 : year;
        key = `${nextYear}-${String(nextMonth).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      }
      if (isDateKey(key)) preference.date = key;
    }
  }

  if (!preference.date) {
    for (const [pattern, weekday] of WEEKDAYS) {
      if (pattern.test(message)) {
        preference.weekday = weekday;
        break;
      }
    }
  }
  return preference;
}

/** Próxima data (a partir de hoje, inclusive) que cai no dia da semana pedido. */
export function nextDateForWeekday(today: string, weekday: number): string {
  const delta = (weekday - weekdayOf(today) + 7) % 7;
  return addDaysToKey(today, delta);
}
