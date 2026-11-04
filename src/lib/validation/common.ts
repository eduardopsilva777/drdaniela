import { z } from "zod";

import { isDateKey, isTimeOfDay } from "@/lib/datetime";
import { parseMoneyToCents } from "@/lib/money";
import { normalizePhone } from "@/lib/phone";

/**
 * Blocos de validação reutilizados pelos formulários. Todas as entradas são
 * revalidadas no servidor; mensagens em português, voltadas para a equipe.
 */

/** Campos de formulário vazios chegam como "" — tratamos como ausentes. */
export function emptyToUndefined(value: unknown): unknown {
  if (value === null) return undefined;
  if (typeof value === "string" && value.trim() === "") return undefined;
  return value;
}

export function requiredText(label: string, max: number, min = 1) {
  return z
    .string({ error: `Informe ${label}.` })
    .trim()
    .min(min, { error: min > 1 ? `${capitalize(label)} deve ter ao menos ${min} caracteres.` : `Informe ${label}.` })
    .max(max, { error: `${capitalize(label)} deve ter no máximo ${max} caracteres.` });
}

export function optionalText(label: string, max: number) {
  return z.preprocess(
    emptyToUndefined,
    z
      .string()
      .trim()
      .max(max, { error: `${capitalize(label)} deve ter no máximo ${max} caracteres.` })
      .optional(),
  );
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export const phoneSchema = z
  .string({ error: "Informe o telefone." })
  .trim()
  .min(1, { error: "Informe o telefone." })
  .transform((value, context) => {
    const normalized = normalizePhone(value);
    if (!normalized) {
      context.addIssue({ code: "custom", message: "Telefone inválido. Informe DDD e número." });
      return z.NEVER;
    }
    return normalized;
  });

export const optionalEmailSchema = z.preprocess(
  emptyToUndefined,
  z
    .email({ error: "E-mail inválido." })
    .max(254, { error: "E-mail muito longo." })
    .transform((value) => value.toLowerCase())
    .optional(),
);

export const uuidSchema = z.uuid({ error: "Identificador inválido." });

export const optionalUuidSchema = z.preprocess(emptyToUndefined, uuidSchema.optional());

export const dateKeySchema = z
  .string({ error: "Informe a data." })
  .refine(isDateKey, { error: "Data inválida." });

export const optionalDateKeySchema = z.preprocess(emptyToUndefined, dateKeySchema.optional());

export const timeSchema = z
  .string({ error: "Informe o horário." })
  .refine(isTimeOfDay, { error: "Horário inválido." });

/** Checkbox HTML: "on" quando marcado, ausente quando não. */
export const checkboxSchema = z.preprocess(
  (value) => value === true || value === "on" || value === "true",
  z.boolean(),
);

export function optionalIntSchema(label: string, min: number, max: number) {
  return z.preprocess(
    emptyToUndefined,
    z.coerce
      .number({ error: `${capitalize(label)} deve ser um número.` })
      .int({ error: `${capitalize(label)} deve ser um número inteiro.` })
      .min(min, { error: `${capitalize(label)} deve ser no mínimo ${min}.` })
      .max(max, { error: `${capitalize(label)} deve ser no máximo ${max}.` })
      .optional(),
  );
}

export function intSchema(label: string, min: number, max: number) {
  return z.coerce
    .number({ error: `Informe ${label}.` })
    .int({ error: `${capitalize(label)} deve ser um número inteiro.` })
    .min(min, { error: `${capitalize(label)} deve ser no mínimo ${min}.` })
    .max(max, { error: `${capitalize(label)} deve ser no máximo ${max}.` });
}

export const optionalMoneySchema = z.preprocess(
  emptyToUndefined,
  z
    .string()
    .transform((value, context) => {
      const cents = parseMoneyToCents(value);
      if (cents === null) {
        context.addIssue({ code: "custom", message: "Valor inválido. Use, por exemplo, 350,00." });
        return z.NEVER;
      }
      return cents;
    })
    .optional(),
);

/** Valores da query string chegam como string | string[] | undefined: usa o primeiro. */
export function firstQueryValue(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value;
}

/** Paginação via query string: valores inválidos voltam ao padrão em vez de falhar. */
export const pageSchema = z.coerce.number().int().min(1).max(10_000).catch(1);

/** Chaves que alterariam o protótipo do objeto montado a partir do formulário. */
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/** Converte FormData em objeto simples (último valor vence; campos múltiplos via getAll). */
export function formDataToObject(formData: FormData): Record<string, FormDataEntryValue> {
  const output: Record<string, FormDataEntryValue> = {};
  for (const [key, value] of formData.entries()) {
    if (UNSAFE_KEYS.has(key)) continue;
    output[key] = value;
  }
  return output;
}
