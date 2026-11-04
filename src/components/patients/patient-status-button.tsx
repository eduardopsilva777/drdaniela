"use client";

import { useState } from "react";

import { ConfirmDialog } from "@/components/forms/confirm-dialog";
import { fieldAria, FormField } from "@/components/forms/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAction } from "@/hooks/use-action";
import { useResetOnHide } from "@/hooks/use-reset-on-hide";
import { firstFieldError } from "@/lib/action-result";
import { setPatientActiveAction } from "@/server/actions/patients";

export function PatientStatusButton({
  patientId,
  patientName,
  isActive,
}: {
  patientId: string;
  patientName: string;
  isActive: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const { run, pending, fieldErrors, reset } = useAction(setPatientActiveAction, {
    onSuccess: () => {
      setOpen(false);
      setReason("");
    },
  });
  useResetOnHide(() => setOpen(false));

  if (!isActive) {
    return (
      <Button variant="outline" disabled={pending} onClick={() => run(patientId, true)}>
        Reativar paciente
      </Button>
    );
  }

  const error = firstFieldError(fieldErrors, "reason");
  return (
    <>
      <Button variant="ghost" onClick={() => setOpen(true)}>
        Inativar
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) reset();
        }}
        title={`Inativar ${patientName}?`}
        description="O cadastro e todo o histórico são mantidos. Lembretes pendentes são cancelados e o paciente deixa de aparecer nas buscas de novos agendamentos."
        confirmLabel="Inativar"
        pending={pending}
        onConfirm={() => run(patientId, false, reason)}
      >
        <FormField label="Motivo" htmlFor="inactivate-reason" error={error}>
          <Input
            {...fieldAria("inactivate-reason", error)}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={200}
            placeholder="Ex.: mudou de cidade"
          />
        </FormField>
      </ConfirmDialog>
    </>
  );
}
