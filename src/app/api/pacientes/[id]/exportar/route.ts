import { unstable_rethrow } from "next/navigation";

import { uuidSchema } from "@/lib/validation/common";
import { requirePermission } from "@/server/auth/dal";
import { AuthorizationError } from "@/server/auth/errors";
import { getContentKeyring } from "@/server/crypto/content-key";
import { getDb } from "@/server/db";
import { NotFoundError } from "@/server/errors";
import { logger } from "@/server/logger";
import { getRequestMeta } from "@/server/request-meta";
import { exportPatientData } from "@/server/services/patients";

/**
 * Exportação dos dados de um paciente (LGPD, art. 18 — acesso/portabilidade).
 * Restrita à administração e registrada na auditoria.
 *
 * GET autenticado por cookie: navegações vindas de outros sites (um link
 * malicioso clicado por alguém da administração) são recusadas pelo cabeçalho
 * Sec-Fetch-Site, enviado pelos navegadores atuais.
 */
export async function GET(request: Request, context: RouteContext<"/api/pacientes/[id]/exportar">) {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const { id } = await context.params;
  if (!uuidSchema.safeParse(id).success) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  try {
    const user = await requirePermission("patients:export");
    const meta = await getRequestMeta();
    const data = await exportPatientData(
      getDb(),
      { id: user.id, name: user.name, role: user.role, ...meta },
      id,
      // Nula sem DATA_ENCRYPTION_KEY: a exportação sai assim mesmo, com os conteúdos cifrados marcados como ilegíveis.
      getContentKeyring(),
    );
    return new Response(JSON.stringify(data, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="paciente-${id}.json"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof AuthorizationError) return Response.json({ error: "forbidden" }, { status: 403 });
    if (error instanceof NotFoundError) return Response.json({ error: "not_found" }, { status: 404 });
    logger.error("patient.export.failed", { err: error });
    return Response.json({ error: "export_failed" }, { status: 500 });
  }
}
