import { connection } from "next/server";

import { getDb } from "@/server/db";
import { logger } from "@/server/logger";

/**
 * Verificação de saúde para monitoramento e orquestradores (Docker, PaaS).
 * Público e sem dados sensíveis: informa apenas se o banco responde.
 */
export async function GET() {
  // Garante execução a cada requisição (nunca pré-renderizado no build).
  await connection();

  const headers = { "Cache-Control": "no-store" };
  const startedAt = performance.now();

  try {
    await getDb().$queryRaw`SELECT 1`;
    return Response.json(
      { status: "ok", database: "ok", latencyMs: Math.round(performance.now() - startedAt) },
      { headers },
    );
  } catch (error) {
    logger.error("health.database_unreachable", { err: error });
    return Response.json({ status: "degraded", database: "unreachable" }, { status: 503, headers });
  }
}
