import type { FieldErrors } from "@/lib/action-result";

/**
 * Violação de regra de negócio com mensagem pronta para a equipe
 * (ex.: "Já existe um lead com este telefone").
 */
export class DomainError extends Error {
  readonly code: string;
  readonly fieldErrors?: FieldErrors;
  readonly meta?: Record<string, string>;

  constructor(
    message: string,
    options: { code?: string; fieldErrors?: FieldErrors; meta?: Record<string, string> } = {},
  ) {
    super(message);
    this.name = "DomainError";
    this.code = options.code ?? "domain_error";
    this.fieldErrors = options.fieldErrors;
    this.meta = options.meta;
  }
}

export class NotFoundError extends DomainError {
  constructor(what: string) {
    super(`${what} não encontrado(a). Ele(a) pode ter sido removido(a).`, { code: "not_found" });
    this.name = "NotFoundError";
  }
}

/** Detecta violação de uma restrição específica do banco (CHECK, UNIQUE, EXCLUDE). */
export function isConstraintViolation(error: unknown, constraintName: string): boolean {
  if (!error || typeof error !== "object") return false;
  const haystack = [
    (error as { message?: unknown }).message,
    JSON.stringify((error as { meta?: unknown }).meta ?? ""),
    (error as { cause?: { message?: unknown } }).cause?.message,
  ]
    .filter((part) => typeof part === "string")
    .join(" ");
  return haystack.includes(constraintName);
}

/**
 * Transação abortada pelo PostgreSQL por conflito de escrita ou deadlock
 * (Prisma P2034; SQLSTATE 40001/40P01). Pode acontecer, por exemplo, quando
 * duas pessoas agendam horários sobrepostos ao mesmo tempo: a restrição de
 * exclusão faz cada inserção esperar pela outra. É seguro repetir.
 */
export function isRetryableTransactionError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  if ((error as { code?: unknown }).code === "P2034") return true;
  const message = String((error as { message?: unknown }).message ?? "");
  return /deadlock detected|could not serialize access|40P01|40001/i.test(message);
}

/** Repete a operação (pré-checagens + transação) quando o banco a abortou por conflito. */
export async function retryOnWriteConflict<T>(operation: () => Promise<T>, attempts = 3): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= attempts || !isRetryableTransactionError(error)) throw error;
      // Pequena espera aleatória para as transações concorrentes não colidirem de novo.
      await new Promise((resolve) => setTimeout(resolve, 20 + Math.floor(Math.random() * 60)));
    }
  }
}

/** Violação de unicidade do Prisma (P2002), opcionalmente em um campo específico. */
export function isUniqueViolation(error: unknown, field?: string): boolean {
  if (!error || typeof error !== "object" || (error as { code?: unknown }).code !== "P2002") {
    return false;
  }
  if (!field) return true;
  return JSON.stringify((error as { meta?: unknown }).meta ?? "").includes(field);
}
