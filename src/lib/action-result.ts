/**
 * Resultado padrão de toda Server Action. Erros esperados (validação, regra de
 * negócio, permissão) voltam como dados — nunca como exceções no cliente.
 */

export type FieldErrors = Partial<Record<string, string[]>>;

export type ActionResult<T = null> =
  | { ok: true; data: T; message?: string }
  | {
      ok: false;
      error: string;
      fieldErrors?: FieldErrors;
      /** Dados extras para a interface reagir (ex.: id do registro duplicado). */
      meta?: Record<string, string>;
    };

export function firstFieldError(errors: FieldErrors | undefined, field: string): string | undefined {
  return errors?.[field]?.[0];
}
