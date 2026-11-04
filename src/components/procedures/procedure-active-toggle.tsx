"use client";

import { useState } from "react";

import { ConfirmDialog } from "@/components/forms/confirm-dialog";
import { Button } from "@/components/ui/button";
import { useAction } from "@/hooks/use-action";
import { setProcedureActiveAction } from "@/server/actions/procedures";

export function ProcedureActiveToggle({
  procedureId,
  name,
  isActive,
}: {
  procedureId: string;
  name: string;
  isActive: boolean;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const { run, pending } = useAction(setProcedureActiveAction, {
    onSuccess: () => setConfirmOpen(false),
  });

  if (!isActive) {
    return (
      <Button variant="ghost" size="sm" disabled={pending} onClick={() => run(procedureId, true)}>
        Reativar
      </Button>
    );
  }

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setConfirmOpen(true)}>
        Desativar
      </Button>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`Desativar ${name}?`}
        description="O procedimento deixa de aparecer em novos agendamentos, leads e protocolos. O histórico de pacientes e agendamentos é mantido, e você pode reativá-lo depois."
        confirmLabel="Desativar"
        pending={pending}
        onConfirm={() => run(procedureId, false)}
      />
    </>
  );
}
