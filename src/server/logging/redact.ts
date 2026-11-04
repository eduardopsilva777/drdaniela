/**
 * Redação de dados sensíveis antes de qualquer saída de log ou auditoria.
 *
 * Duas camadas:
 * 1. Chaves com nomes sensíveis têm o valor inteiro substituído.
 * 2. Textos livres têm e-mails, CPFs e telefones mascarados (ex.: mensagens de
 *    erro de banco, que podem repetir valores da linha que falhou).
 */

const SENSITIVE_KEY_PATTERN =
  /pass(word)?|senha|secret|token|authorization|cookie|session|api[-_]?key|signature|phone|telefone|e-?mail|cpf|birth|nascimento|content|body|note|observa|address|endereco/i;

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const CPF_PATTERN = /(?<![\w-])\d{3}\.?\d{3}\.?\d{3}-?\d{2}(?![\w-])/g;
const E164_PATTERN = /\+\d{10,15}(?!\d)/g;
const BR_PHONE_PATTERN = /(?<![\w/-])(?:\+?55[\s-]?)?\(?\d{2}\)?[\s-]?9?\d{4}[\s-]?\d{4}(?![\w-])/g;
/**
 * O PostgreSQL repete valores da linha nas mensagens de erro de restrição
 * (nomes, telefones…): "Failing row contains (…)" (CHECK/NOT NULL) e
 * "Key (campo)=(valor)" (UNIQUE/EXCLUDE). Os valores são omitidos; o nome da
 * restrição e dos campos continua no log para o diagnóstico.
 */
const PG_FAILING_ROW_PATTERN = /Failing row contains \(.*$/gim;
// A lista de campos pode ter parênteses aninhados (ex.: tstzrange(...) da agenda).
const PG_KEY_VALUE_PATTERN = /Key \((.*?)\)=\((.*?)\)(?= already exists| conflicts with|\.?\s*$)/gim;
/** Rede de segurança: qualquer "Key (…)=(" que sobrar tem o resto da linha omitido. */
const PG_KEY_VALUE_FALLBACK = /Key \((.*?)\)=\((?!\[valor omitido\]).*$/gim;

/**
 * Chaves técnicas cujos valores são identificadores gerados pelo sistema (não
 * dados pessoais). Não passam pelo mascaramento de texto — um `digest` numérico
 * de 10 dígitos, por exemplo, seria confundido com um telefone e perderia a
 * utilidade de correlacionar o erro exibido ao usuário com o log.
 */
const TECHNICAL_KEYS = new Set([
  "digest",
  "requestId",
  "userId",
  "actorId",
  "entityId",
  "entityType",
  "id",
  "code",
  "method",
  "routePath",
  "routeType",
  "permission",
  "action",
  "scope",
  "reason",
]);

const MAX_DEPTH = 6;
const MAX_ARRAY_ITEMS = 50;
const MAX_STRING_LENGTH = 2000;

export const REDACTED = "[REDACTED]";

export function maskSensitiveText(text: string): string {
  // Telefone antes de CPF: um celular sem formatação também tem 11 dígitos, mas
  // o terceiro é sempre 9. O que sobrar com formato de CPF é mascarado em seguida.
  const masked = text
    .replace(PG_FAILING_ROW_PATTERN, "Failing row contains ([valores omitidos])")
    .replace(PG_KEY_VALUE_PATTERN, "Key ($1)=([valor omitido])")
    .replace(PG_KEY_VALUE_FALLBACK, "Key ($1)=([valor omitido])")
    .replace(EMAIL_PATTERN, "[email]")
    .replace(E164_PATTERN, "[telefone]")
    .replace(BR_PHONE_PATTERN, "[telefone]")
    .replace(CPF_PATTERN, "[cpf]");
  return masked.length > MAX_STRING_LENGTH ? `${masked.slice(0, MAX_STRING_LENGTH)}…` : masked;
}

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key);
}

export interface SerializedError {
  name: string;
  message: string;
  code?: string;
  stack?: string;
}

export function serializeError(error: unknown, includeStack = false): SerializedError {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    return {
      name: error.name,
      message: maskSensitiveText(error.message),
      ...(typeof code === "string" ? { code } : {}),
      ...(includeStack && error.stack ? { stack: maskSensitiveText(error.stack) } : {}),
    };
  }
  return { name: "NonError", message: maskSensitiveText(String(error)) };
}

export function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return maskSensitiveText(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return serializeError(value);
  if (depth >= MAX_DEPTH) return "[…]";

  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_ITEMS).map((item) => redact(item, depth + 1));
  }

  if (typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (isSensitiveKey(key)) {
        output[key] = REDACTED;
      } else if (TECHNICAL_KEYS.has(key) && (typeof item === "string" || typeof item === "number")) {
        output[key] = item;
      } else {
        output[key] = redact(item, depth + 1);
      }
    }
    return output;
  }

  return `[${typeof value}]`;
}
