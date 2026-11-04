import { handleAutomationRequest } from "@/server/jobs/automation-route";

/**
 * Ciclo de automação: lembretes, etapas de acompanhamento, execuções pendentes
 * do assistente e reenvios. Detalhes em src/server/jobs/automation-route.ts.
 */

export async function POST(request: Request) {
  return handleAutomationRequest(request);
}

/** Alguns agendadores (ex.: Vercel Cron) só fazem GET — com a mesma exigência de segredo. */
export async function GET(request: Request) {
  return handleAutomationRequest(request);
}
