"use client";

import { Send } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { processReminderQueueAction } from "@/server/actions/messaging";

/**
 * Processa agora os lembretes vencidos (o mesmo que o agendador faz
 * periodicamente). Sem integração ativa, nada é enviado e isso é informado.
 */
export function ProcessQueueButton({ simulated }: { simulated: boolean }) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="outline"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await processReminderQueueAction().catch(() => null);
          if (!result || !result.ok) {
            toast.error(result && !result.ok ? result.error : "Falha de conexão. Tente de novo.");
            return;
          }
          const { reminders: summary, assistant, messages } = result.data;
          const nothing = summary.claimed === 0 && assistant.claimed === 0 && messages.retried === 0;
          if (nothing) {
            toast.info(summary.skippedReason ?? "Nada vencido para processar agora.");
            return;
          }
          const parts = [
            summary.sent ? `${summary.sent} enviado(s)` : null,
            summary.simulated ? `${summary.simulated} simulado(s) — nada saiu do servidor` : null,
            summary.tasks ? `${summary.tasks} tarefa(s) para a equipe` : null,
            summary.deferred ? `${summary.deferred} adiado(s) (horário permitido ou limite de envios)` : null,
            summary.retried ? `${summary.retried} com nova tentativa agendada` : null,
            summary.failed ? `${summary.failed} com falha` : null,
            summary.cancelled ? `${summary.cancelled} cancelado(s)` : null,
            assistant.claimed ? `${assistant.claimed} mensagem(ns) pendente(s) do assistente` : null,
            messages.retried ? `${messages.retried} reenvio(s)` : null,
          ].filter(Boolean);
          toast.success(`Fila processada: ${parts.join(", ")}.`);
        })
      }
    >
      <Send aria-hidden />
      {pending ? "Processando…" : simulated ? "Processar fila (simulação)" : "Processar fila agora"}
    </Button>
  );
}
