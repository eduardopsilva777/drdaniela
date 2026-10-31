import "server-only";

import { z } from "zod";

/**
 * Variáveis de ambiente do servidor, validadas com Zod.
 *
 * A validação é preguiçosa (na primeira leitura) para que `next build` não
 * exija segredos de execução; o `instrumentation.ts` força a validação na
 * inicialização do servidor, falhando cedo e com mensagem clara.
 * Mensagens de erro listam apenas NOMES de variáveis — nunca valores.
 */

function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("pt-BR", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const serverEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z
    .string({ error: "obrigatória" })
    .min(1, { error: "obrigatória" })
    .refine((value) => /^postgres(ql)?:\/\//.test(value), {
      error: "deve ser uma URL postgresql://",
    }),
  APP_URL: z.url({ error: "deve ser uma URL válida" }).optional(),
  APP_TIMEZONE: z
    .string()
    .default("America/Sao_Paulo")
    .refine(isValidTimeZone, { error: "fuso horário IANA inválido" }),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  SESSION_MAX_AGE_HOURS: z.coerce.number().int().min(1).max(72).default(12),
  SESSION_IDLE_TIMEOUT_MINUTES: z.coerce.number().int().min(5).max(1440).default(120),
  TRUST_PROXY: z.stringbool().default(false),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export function parseServerEnv(source: Record<string, string | undefined>): ServerEnv {
  const result = serverEnvSchema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `${issue.path.join(".") || "(raiz)"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Configuração de ambiente inválida — ${problems}`);
  }
  return result.data;
}

let cachedEnv: ServerEnv | undefined;

export function getServerEnv(): ServerEnv {
  cachedEnv ??= parseServerEnv(process.env);
  return cachedEnv;
}
