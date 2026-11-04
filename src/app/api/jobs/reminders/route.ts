import { handleAutomationRequest } from "@/server/jobs/automation-route";

/**
 * Endereço anterior do agendador, mantido por compatibilidade: executa o
 * mesmo ciclo completo de /api/jobs/automation (lembretes, acompanhamento,
 * assistente e reenvios). Prefira o novo endereço em novas configurações.
 */

export async function POST(request: Request) {
  return handleAutomationRequest(request);
}

export async function GET(request: Request) {
  return handleAutomationRequest(request);
}
