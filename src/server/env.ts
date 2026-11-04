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

const optionalSecret = (min: number) =>
  z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.string().min(min, { error: `deve ter ao menos ${min} caracteres` }).optional(),
  );

export const serverEnvSchema = z
  .object({
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

    /** Chave AES-256 (32 bytes em base64) para cifrar observações de pacientes. */
    DATA_ENCRYPTION_KEY: optionalSecret(40).refine(
      (value) => value === undefined || Buffer.from(value, "base64").length === 32,
      { error: "deve conter 32 bytes em base64 (openssl rand -base64 32)" },
    ),
    /** Chave anterior, aceita só na leitura durante uma rotação (docs/operacao.md). */
    DATA_ENCRYPTION_KEY_PREVIOUS: optionalSecret(40).refine(
      (value) => value === undefined || Buffer.from(value, "base64").length === 32,
      { error: "deve conter 32 bytes em base64" },
    ),

    /** Segredo exigido pelo endpoint que processa a fila de lembretes (cron). */
    CRON_SECRET: optionalSecret(32),

    REMINDER_RETURN_DAYS_BEFORE: z.coerce.number().int().min(0).max(30).default(2),
    REMINDER_APPOINTMENT_HOURS_BEFORE: z.coerce.number().int().min(1).max(168).default(24),

    /**
     * disabled: nenhuma mensagem é enviada (lembretes ficam registrados no CRM).
     * development: mensagens ficam só no banco, marcadas como simuladas.
     * cloud_api: envio real pela API oficial do WhatsApp Business (Meta).
     */
    WHATSAPP_PROVIDER: z.enum(["disabled", "development", "cloud_api"]).optional(),
    WHATSAPP_GRAPH_API_VERSION: z
      .string()
      .regex(/^v\d+\.\d+$/, { error: "formato esperado: v23.0" })
      .default("v23.0"),
    WHATSAPP_PHONE_NUMBER_ID: optionalSecret(5),
    WHATSAPP_BUSINESS_ACCOUNT_ID: optionalSecret(5),
    WHATSAPP_ACCESS_TOKEN: optionalSecret(20),
    WHATSAPP_APP_SECRET: optionalSecret(16),
    WHATSAPP_WEBHOOK_VERIFY_TOKEN: optionalSecret(16),
    WHATSAPP_TEMPLATE_LANGUAGE: z.string().default("pt_BR"),
    WHATSAPP_TEMPLATE_RETURN_REMINDER: optionalSecret(1),
    WHATSAPP_TEMPLATE_APPOINTMENT_REMINDER: optionalSecret(1),

    /**
     * Motor do assistente virtual do WhatsApp:
     * disabled:  o assistente não responde (atendimento só pela equipe) — padrão em produção.
     * rules:     motor por regras, sem IA generativa: responde só com textos aprovados — padrão fora de produção.
     * anthropic: IA generativa (Claude). Ver AI_ENGINE.
     */
    AI_PROVIDER: z.enum(["disabled", "rules", "anthropic"]).optional(),
    /**
     * Com AI_PROVIDER=anthropic:
     * agent:  conversa gerada pela IA a cada mensagem, com ferramentas do CRM executadas e validadas pelo servidor (padrão).
     * guided: a IA só interpreta a mensagem; o roteiro e os textos são os configurados (motor anterior).
     */
    AI_ENGINE: z.enum(["agent", "guided"]).default("agent"),
    /** Teto de tokens gerados por chamada (inclui o raciocínio do modelo). */
    AI_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(1_000).max(32_000).default(8_000),
    /** Tempo máximo de um turno completo da IA (todas as chamadas e ferramentas). */
    AI_TURN_TIMEOUT_MS: z.coerce.number().int().min(15_000).max(300_000).default(120_000),
    /** Chamadas simultâneas ao provedor de IA por processo. */
    AI_MAX_CONCURRENCY: z.coerce.number().int().min(1).max(20).default(3),
    /**
     * Preços (US$ por milhão de tokens) usados só para ESTIMAR o custo e aplicar o
     * limite mensal. Padrões: claude-opus-5-5. Atualize ao trocar de modelo.
     */
    AI_PRICE_INPUT_PER_MTOK: z.coerce.number().min(0).max(1_000).default(4),
    AI_PRICE_OUTPUT_PER_MTOK: z.coerce.number().min(0).max(1_000).default(20),
    AI_PRICE_CACHE_READ_PER_MTOK: z.coerce.number().min(0).max(1_000).default(0.2),
    AI_PRICE_CACHE_WRITE_PER_MTOK: z.coerce.number().min(0).max(1_000).default(5),
    ANTHROPIC_API_KEY: optionalSecret(20),
    ANTHROPIC_MODEL: z
      .string()
      .regex(/^claude-[a-z0-9.-]+$/, { error: "identificador de modelo inválido (ex.: claude-opus-5-5)" })
      .default("claude-opus-5-5"),
    AI_EFFORT: z.enum(["low", "medium", "high"]).default("medium"),
    AI_TIMEOUT_MS: z.coerce.number().int().min(5_000).max(120_000).default(30_000),
  })
  .transform((env) => ({
    ...env,
    // Padrão seguro: simulação só fora de produção; em produção, desativado.
    WHATSAPP_PROVIDER:
      env.WHATSAPP_PROVIDER ?? (env.NODE_ENV === "production" ? "disabled" : "development"),
    // O assistente só usa IA generativa quando configurado explicitamente.
    AI_PROVIDER: env.AI_PROVIDER ?? (env.NODE_ENV === "production" ? "disabled" : "rules"),
  }))
  .superRefine((env, context) => {
    if (env.DATA_ENCRYPTION_KEY_PREVIOUS && !env.DATA_ENCRYPTION_KEY) {
      context.addIssue({
        code: "custom",
        path: ["DATA_ENCRYPTION_KEY"],
        message: "obrigatória quando DATA_ENCRYPTION_KEY_PREVIOUS está definida",
      });
    }
    if (env.DATA_ENCRYPTION_KEY_PREVIOUS && env.DATA_ENCRYPTION_KEY_PREVIOUS === env.DATA_ENCRYPTION_KEY) {
      context.addIssue({
        code: "custom",
        path: ["DATA_ENCRYPTION_KEY_PREVIOUS"],
        message: "deve ser diferente de DATA_ENCRYPTION_KEY",
      });
    }
    if (env.WHATSAPP_PROVIDER === "development" && env.NODE_ENV === "production") {
      context.addIssue({
        code: "custom",
        path: ["WHATSAPP_PROVIDER"],
        message: "o adaptador de desenvolvimento não pode ser usado em produção",
      });
    }
    if (env.AI_PROVIDER === "anthropic" && !env.ANTHROPIC_API_KEY) {
      context.addIssue({ code: "custom", path: ["ANTHROPIC_API_KEY"], message: "obrigatória com AI_PROVIDER=anthropic" });
    }
    if (env.WHATSAPP_PROVIDER === "cloud_api") {
      for (const key of [
        "WHATSAPP_PHONE_NUMBER_ID",
        "WHATSAPP_ACCESS_TOKEN",
        "WHATSAPP_APP_SECRET",
        "WHATSAPP_WEBHOOK_VERIFY_TOKEN",
      ] as const) {
        if (!env[key]) {
          context.addIssue({ code: "custom", path: [key], message: "obrigatória com WHATSAPP_PROVIDER=cloud_api" });
        }
      }
    }
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

/**
 * Configurações aceitas, mas arriscadas em produção: desativam silenciosamente
 * uma proteção ou rotina. Listadas na inicialização (apenas nomes, nunca valores).
 */
export function productionConfigWarnings(env: ServerEnv): string[] {
  if (env.NODE_ENV !== "production") return [];
  const warnings: string[] = [];
  if (!env.APP_URL?.startsWith("https://")) {
    warnings.push("APP_URL ausente ou sem https:// — HSTS e upgrade-insecure-requests ficam desativados (defina-a também no build).");
  }
  if (!env.DATA_ENCRYPTION_KEY) {
    warnings.push(
      "DATA_ENCRYPTION_KEY ausente — observações de pacientes ficam indisponíveis e mensagens do WhatsApp ficam sem cifragem.",
    );
  }
  if (env.DATA_ENCRYPTION_KEY_PREVIOUS) {
    warnings.push("DATA_ENCRYPTION_KEY_PREVIOUS definida — conclua a rotação (npm run data:rotate-key -- --apply) e remova a chave anterior.");
  }
  if (!env.CRON_SECRET) {
    warnings.push("CRON_SECRET ausente — /api/jobs/reminders fica desativado e a fila de lembretes não é processada automaticamente.");
  }
  if (
    env.WHATSAPP_PROVIDER === "cloud_api" &&
    (!env.WHATSAPP_TEMPLATE_APPOINTMENT_REMINDER || !env.WHATSAPP_TEMPLATE_RETURN_REMINDER)
  ) {
    warnings.push(
      "Nenhum modelo de lembrete em variável de ambiente — cadastre e aprove os modelos em Assistente › Modelos (sem eles os lembretes falham).",
    );
  }
  if (env.AI_PROVIDER === "anthropic") {
    warnings.push(
      "AI_PROVIDER=anthropic — trechos mascarados das conversas são enviados à Anthropic: confirme contrato e base legal (LGPD art. 33) antes de atender pacientes.",
    );
  }
  return warnings;
}

let cachedEnv: ServerEnv | undefined;

export function getServerEnv(): ServerEnv {
  cachedEnv ??= parseServerEnv(process.env);
  return cachedEnv;
}
