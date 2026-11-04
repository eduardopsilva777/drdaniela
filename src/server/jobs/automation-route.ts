import "server-only";

import { timingSafeEqual } from "node:crypto";

import { getAutomationDependencies } from "@/server/assistant/runtime";
import { recordAudit } from "@/server/audit";
import { getDb } from "@/server/db";
import { getServerEnv } from "@/server/env";
import { logger } from "@/server/logger";
import { runAutomationCycle } from "@/server/services/automation";

/**
 * Ciclo de automação disparado por um agendador externo (cron do provedor de
 * hospedagem, GitHub Actions, systemd timer…) a cada poucos minutos:
 *
 *   curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://.../api/jobs/automation
 *
 * Exige CRON_SECRET. Execuções simultâneas são seguras. Com a integração do
 * WhatsApp desativada, nenhuma mensagem é enviada (tarefas da equipe seguem).
 */

function authorized(header: string | null, secret: string): boolean {
  if (!header) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(header);
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export async function handleAutomationRequest(request: Request): Promise<Response> {
  const env = getServerEnv();
  if (!env.CRON_SECRET) return Response.json({ error: "not_configured" }, { status: 404 });
  if (!authorized(request.headers.get("authorization"), env.CRON_SECRET)) {
    logger.warn("jobs.automation.unauthorized");
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const db = getDb();
    const summary = await runAutomationCycle(db, getAutomationDependencies());
    const touched = summary.reminders.claimed + summary.assistant.claimed + summary.messages.retried;
    if (touched > 0) {
      await recordAudit(db, {
        action: "automation.run",
        metadata: {
          source: "cron",
          reminders: summary.reminders.claimed,
          remindersFailed: summary.reminders.failed,
          assistantRuns: summary.assistant.claimed,
          assistantFailed: summary.assistant.failed,
          retries: summary.messages.retried,
        },
      });
    }
    return Response.json(summary);
  } catch (error) {
    logger.error("jobs.automation.failed", { err: error });
    return Response.json({ error: "processing_failed" }, { status: 500 });
  }
}
