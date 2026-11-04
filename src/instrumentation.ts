import type { Instrumentation } from "next";

/**
 * Executado uma vez na inicialização do servidor: valida as variáveis de
 * ambiente para falhar cedo (e com mensagem clara) se algo estiver faltando.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { getServerEnv, productionConfigWarnings } = await import("./server/env");
    const env = getServerEnv();
    const warnings = productionConfigWarnings(env);
    if (warnings.length > 0) {
      const { logger } = await import("./server/logger");
      for (const warning of warnings) logger.warn("config.production_warning", { warning });
    }
  }
}

/**
 * Erros de servidor não tratados: registra apenas metadados técnicos.
 * A query string é descartada (pode conter termos de busca com nomes de pacientes).
 */
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { logger } = await import("./server/logger");
  const digest =
    typeof error === "object" && error !== null && "digest" in error
      ? String((error as { digest: unknown }).digest)
      : undefined;
  logger.error("request.unhandled_error", {
    err: error,
    digest,
    method: request.method,
    path: request.path.split("?")[0],
    routePath: context.routePath,
    routeType: context.routeType,
  });
};
