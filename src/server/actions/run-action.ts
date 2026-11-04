import "server-only";

import { refresh } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";

import type { ActionResult } from "@/lib/action-result";
import type { Permission } from "@/lib/auth/permissions";
import { requirePermission } from "@/server/auth/dal";
import { AuthorizationError } from "@/server/auth/errors";
import { getDb, type DbClient } from "@/server/db";
import { DomainError } from "@/server/errors";
import { logger } from "@/server/logger";
import { getRequestMeta } from "@/server/request-meta";
import type { Actor } from "@/server/services/context";

export interface ActionContext {
  actor: Actor;
  db: DbClient;
}

interface RunOptions {
  /** Mensagem de sucesso exibida pela interface. */
  message?: string;
  /** Re-renderiza a rota atual com dados atualizados (padrão: sim). */
  refresh?: boolean;
}

/**
 * Envelope de toda Server Action:
 * 1. Exige sessão válida e a permissão (com auditoria em caso de negação).
 * 2. Executa a operação com o ator autenticado.
 * 3. Converte erros esperados em respostas amigáveis e registra os inesperados
 *    sem expor detalhes ao navegador.
 */
export async function runAction<T>(
  permission: Permission,
  handler: (context: ActionContext) => Promise<T>,
  options: RunOptions = {},
): Promise<ActionResult<T>> {
  try {
    const user = await requirePermission(permission);
    const meta = await getRequestMeta();
    const data = await handler({
      actor: { id: user.id, name: user.name, role: user.role, ...meta },
      db: getDb(),
    });
    if (options.refresh !== false) refresh();
    return { ok: true, data, message: options.message };
  } catch (error) {
    unstable_rethrow(error);
    return toFailure(error, permission);
  }
}

export function toFailure(error: unknown, permission?: Permission): ActionResult<never> {
  if (error instanceof AuthorizationError) {
    return { ok: false, error: "Seu perfil não permite realizar esta operação." };
  }
  if (error instanceof z.ZodError) {
    return {
      ok: false,
      error: "Revise os campos destacados.",
      fieldErrors: z.flattenError(error).fieldErrors as Record<string, string[]>,
    };
  }
  if (error instanceof DomainError) {
    return { ok: false, error: error.message, fieldErrors: error.fieldErrors, meta: error.meta };
  }
  logger.error("action.failed", { err: error, permission });
  return { ok: false, error: "Não foi possível concluir a operação. Tente novamente em instantes." };
}
