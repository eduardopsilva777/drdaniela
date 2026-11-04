"use client";

import { Pause, Play, X } from "lucide-react";
import { useState } from "react";

import { ConfirmDialog } from "@/components/forms/confirm-dialog";
import { Button } from "@/components/ui/button";
import { useAction } from "@/hooks/use-action";
import { cancelSequenceAction, pauseSequenceAction, resumeSequenceAction } from "@/server/actions/assistant";

/** Pausar, retomar ou cancelar a sequência de acompanhamento de um retorno. */
export function SequenceActions({ returnId, status }: { returnId: string; status: "PENDING" | "PAUSED" }) {
  const [confirm, setConfirm] = useState(false);
  const pause = useAction(pauseSequenceAction);
  const resume = useAction(resumeSequenceAction);
  const cancel = useAction(cancelSequenceAction, { onSuccess: () => setConfirm(false) });
  const pending = pause.pending || resume.pending || cancel.pending;
  return (
    <>
      {status === "PAUSED" ? (
        <Button size="sm" variant="outline" disabled={pending} onClick={() => resume.run(returnId)}>
          <Play aria-hidden />
          Retomar sequência
        </Button>
      ) : (
        <Button size="sm" variant="ghost" disabled={pending} onClick={() => pause.run(returnId)}>
          <Pause aria-hidden />
          Pausar
        </Button>
      )}
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => setConfirm(true)}>
        <X aria-hidden />
        Encerrar sequência
      </Button>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Encerrar a sequência de acompanhamento?"
        description="As etapas pendentes e pausadas deste retorno são canceladas. O retorno continua na lista de retornos; para reprogramar, altere a data prevista."
        confirmLabel="Encerrar sequência"
        pending={pending}
        onConfirm={() => cancel.run(returnId)}
      />
    </>
  );
}
