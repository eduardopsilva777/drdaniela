"use client";

import { useState } from "react";

import { fieldAria, FormField } from "@/components/forms/form-field";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

const COMMON_REASONS = [
  "Preço acima do esperado",
  "Sem resposta após contatos",
  "Escolheu outra clínica",
  "Não é o momento",
  "Procedimento não oferecido",
];

/** Motivo obrigatório ao marcar um lead como perdido (alimenta a análise do funil). */
export function LostReasonDialog({
  leadName,
  open,
  onOpenChange,
  onConfirm,
  pending,
}: {
  leadName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (reason: string) => void;
  pending?: boolean;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string>();

  function submit() {
    const trimmed = reason.trim();
    if (trimmed.length < 3) {
      setError("Descreva o motivo da perda.");
      return;
    }
    onConfirm(trimmed);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) {
          setReason("");
          setError(undefined);
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Marcar {leadName} como perdido</DialogTitle>
          <DialogDescription>O motivo fica no histórico e ajuda a entender onde o funil perde contatos.</DialogDescription>
        </DialogHeader>
        <form
          noValidate
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <div className="flex flex-wrap gap-2">
            {COMMON_REASONS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => {
                  setReason(option);
                  setError(undefined);
                }}
                className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground aria-pressed:border-primary/60 aria-pressed:text-foreground"
                aria-pressed={reason === option}
              >
                {option}
              </button>
            ))}
          </div>
          <FormField label="Motivo da perda" htmlFor="lost-reason" error={error}>
            <Input
              {...fieldAria("lost-reason", error)}
              value={reason}
              onChange={(event) => {
                setReason(event.target.value);
                setError(undefined);
              }}
              maxLength={200}
              autoFocus
            />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Salvando…" : "Marcar como perdido"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
