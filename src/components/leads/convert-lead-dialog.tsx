"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { fieldAria, FormField } from "@/components/forms/form-field";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useAction } from "@/hooks/use-action";
import { firstFieldError } from "@/lib/action-result";
import { cn } from "@/lib/utils";
import { convertLeadAction } from "@/server/actions/leads";

export interface ConvertibleLead {
  id: string;
  name: string;
  phoneLabel: string;
  email: string | null;
  whatsappOptIn: boolean;
}

export interface PatientMatch {
  id: string;
  fullName: string;
}

/**
 * Conversão de lead em paciente. Se já existir paciente com o mesmo telefone,
 * a opção padrão é vincular ao cadastro existente (evita duplicidade).
 */
export function ConvertLeadDialog({
  lead,
  matches,
  open,
  onOpenChange,
}: {
  lead: ConvertibleLead;
  matches: PatientMatch[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"create" | "link">(matches.length > 0 ? "link" : "create");
  const [linkId, setLinkId] = useState(matches[0]?.id ?? "");
  const action = convertLeadAction.bind(null, lead.id);
  const { run, pending, fieldErrors, error, reset } = useAction(action, {
    successMessage: false,
    onSuccess: ({ patientId }) => {
      onOpenChange(false);
      toast.success(`${lead.name} agora é paciente.`, {
        action: { label: "Abrir ficha", onClick: () => router.push(`/pacientes/${patientId}`) },
      });
    },
  });
  const fieldError = (field: string) => firstFieldError(fieldErrors, field);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) reset();
      }}
    >
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Converter {lead.name} em paciente</DialogTitle>
          <DialogDescription>
            O histórico comercial, a origem e o interesse do lead passam a aparecer na ficha do paciente.
          </DialogDescription>
        </DialogHeader>

        <form
          noValidate
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            data.set("mode", mode);
            data.set("existingPatientId", mode === "link" ? linkId : "");
            if (mode === "link") data.set("fullName", matches.find((item) => item.id === linkId)?.fullName ?? lead.name);
            run(data);
          }}
        >
          {matches.length > 0 ? (
            <fieldset className="space-y-2">
              <legend className="text-sm text-muted-foreground">
                Já existe paciente com o telefone {lead.phoneLabel}:
              </legend>
              {matches.map((match) => (
                <label
                  key={match.id}
                  className={cn(
                    "flex cursor-pointer items-center gap-3 rounded-xl border border-border p-3 text-sm",
                    mode === "link" && linkId === match.id && "border-rose/50 bg-rose/[0.05]",
                  )}
                >
                  <input
                    type="radio"
                    name="choice"
                    className="accent-[var(--rose)]"
                    checked={mode === "link" && linkId === match.id}
                    onChange={() => {
                      setMode("link");
                      setLinkId(match.id);
                    }}
                  />
                  Vincular a {match.fullName}
                </label>
              ))}
              <label
                className={cn(
                  "flex cursor-pointer items-center gap-3 rounded-xl border border-border p-3 text-sm",
                  mode === "create" && "border-rose/50 bg-rose/[0.05]",
                )}
              >
                <input
                  type="radio"
                  name="choice"
                  className="accent-[var(--rose)]"
                  checked={mode === "create"}
                  onChange={() => setMode("create")}
                />
                É outra pessoa: criar novo cadastro
              </label>
            </fieldset>
          ) : null}

          {mode === "create" ? (
            <div className="space-y-4">
              <FormField label="Nome completo do paciente" htmlFor="convert-name" error={fieldError("fullName")}>
                <Input {...fieldAria("convert-name", fieldError("fullName"))} name="fullName" defaultValue={lead.name} maxLength={120} />
              </FormField>
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="E-mail" htmlFor="convert-email" optional error={fieldError("email")}>
                  <Input {...fieldAria("convert-email", fieldError("email"))} name="email" type="email" defaultValue={lead.email ?? ""} />
                </FormField>
                <FormField label="Data de nascimento" htmlFor="convert-birth" optional error={fieldError("birthDate")}>
                  <Input {...fieldAria("convert-birth", fieldError("birthDate"))} name="birthDate" type="date" />
                </FormField>
              </div>
              <label className="flex items-start gap-3 text-sm">
                <Checkbox name="whatsappOptIn" defaultChecked={lead.whatsappOptIn} className="mt-0.5" />
                <span>
                  Autorizou receber mensagens pelo WhatsApp
                  <span className="block text-xs text-muted-foreground">
                    Necessário para lembretes de retorno e de agendamento.
                  </span>
                </span>
              </label>
              {matches.length > 0 ? (
                <label className="flex items-start gap-3 text-sm">
                  <Checkbox name="confirmDuplicatePhone" className="mt-0.5" />
                  <span>Confirmo que é outra pessoa com o mesmo telefone (ex.: telefone do responsável).</span>
                </label>
              ) : null}
            </div>
          ) : null}

          {error && !fieldErrors ? <p className="text-sm text-brick">{error}</p> : null}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Convertendo…" : mode === "link" ? "Vincular e converter" : "Converter em paciente"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
