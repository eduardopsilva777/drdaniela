"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";

import { fieldAria, FormField } from "@/components/forms/form-field";
import { FormSelect, type SelectOption } from "@/components/forms/form-select";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/hooks/use-action";
import { useResetOnHide } from "@/hooks/use-reset-on-hide";
import { firstFieldError } from "@/lib/action-result";
import { LEAD_PRIORITY_LABELS, LEAD_SOURCE_LABELS } from "@/lib/labels";
import { saveLeadAction } from "@/server/actions/leads";

export interface LeadFormValues {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  source: string;
  sourceDetail: string | null;
  interest: string | null;
  procedureId: string | null;
  priority: string;
  ownerId: string | null;
  notes: string | null;
  whatsappOptIn: boolean;
  nextActionDate: string | null;
  nextActionTime: string | null;
  nextActionNote: string | null;
}

const SOURCE_OPTIONS = Object.entries(LEAD_SOURCE_LABELS).map(([value, label]) => ({ value, label }));
const PRIORITY_OPTIONS = Object.entries(LEAD_PRIORITY_LABELS).map(([value, label]) => ({ value, label }));

export function LeadFormDialog({
  lead,
  procedures,
  staff,
  trigger,
}: {
  lead?: LeadFormValues;
  procedures: SelectOption[];
  staff: SelectOption[];
  trigger: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const action = saveLeadAction.bind(null, lead?.id ?? null);
  const { run, pending, fieldErrors, meta, reset } = useAction(action, { onSuccess: () => setOpen(false) });
  useResetOnHide(() => setOpen(false));
  const error = (field: string) => firstFieldError(fieldErrors, field);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{lead ? "Editar lead" : "Novo lead"}</DialogTitle>
          <DialogDescription>
            Registre apenas dados comerciais. Informações clínicas ficam na ficha do paciente, com acesso restrito.
          </DialogDescription>
        </DialogHeader>

        <form
          noValidate
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            run(new FormData(event.currentTarget));
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Nome completo" htmlFor="lead-name" error={error("name")}>
              <Input {...fieldAria("lead-name", error("name"))} name="name" defaultValue={lead?.name} maxLength={120} autoFocus />
            </FormField>
            <FormField label="Telefone (com DDD)" htmlFor="lead-phone" error={error("phone")}>
              <Input
                {...fieldAria("lead-phone", error("phone"))}
                name="phone"
                type="tel"
                inputMode="tel"
                autoComplete="off"
                placeholder="(11) 98765-4321"
                defaultValue={lead?.phone}
                maxLength={32}
              />
            </FormField>
          </div>
          {meta?.existingLeadId ? (
            <p className="-mt-2 text-sm">
              <Link href={`/leads/${meta.existingLeadId}`} className="text-primary underline underline-offset-4">
                Abrir o lead existente
              </Link>
            </p>
          ) : null}
          {meta?.existingPatientId ? (
            <p className="-mt-2 text-sm">
              <Link href={`/pacientes/${meta.existingPatientId}`} className="text-primary underline underline-offset-4">
                Abrir a ficha do paciente
              </Link>
            </p>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="E-mail" htmlFor="lead-email" optional error={error("email")}>
              <Input {...fieldAria("lead-email", error("email"))} name="email" type="email" defaultValue={lead?.email ?? ""} maxLength={254} />
            </FormField>
            <FormField label="Responsável" htmlFor="lead-owner" optional error={error("ownerId")}>
              <FormSelect id="lead-owner" name="ownerId" options={staff} defaultValue={lead?.ownerId} emptyLabel="Sem responsável" invalid={Boolean(error("ownerId"))} />
            </FormField>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Origem" htmlFor="lead-source" error={error("source")}>
              <FormSelect id="lead-source" name="source" options={SOURCE_OPTIONS} defaultValue={lead?.source ?? "INSTAGRAM"} invalid={Boolean(error("source"))} />
            </FormField>
            <FormField label="Complemento da origem" htmlFor="lead-source-detail" optional error={error("sourceDetail")}>
              <Input
                {...fieldAria("lead-source-detail", error("sourceDetail"))}
                name="sourceDetail"
                placeholder="Ex.: campanha de outubro, indicação da Ana"
                defaultValue={lead?.sourceDetail ?? ""}
                maxLength={120}
              />
            </FormField>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Procedimento de interesse" htmlFor="lead-procedure" optional error={error("procedureId")}>
              <FormSelect id="lead-procedure" name="procedureId" options={procedures} defaultValue={lead?.procedureId} emptyLabel="Nenhum específico" />
            </FormField>
            <FormField label="Prioridade" htmlFor="lead-priority" error={error("priority")}>
              <FormSelect id="lead-priority" name="priority" options={PRIORITY_OPTIONS} defaultValue={lead?.priority ?? "MEDIUM"} />
            </FormField>
          </div>

          <FormField label="Interesse (em poucas palavras)" htmlFor="lead-interest" optional error={error("interest")}>
            <Input
              {...fieldAria("lead-interest", error("interest"))}
              name="interest"
              placeholder="Ex.: quer saber valores de harmonização"
              defaultValue={lead?.interest ?? ""}
              maxLength={200}
            />
          </FormField>

          <fieldset className="space-y-3 rounded-xl border border-border p-4">
            <legend className="px-1 text-[0.8125rem] font-medium">Próxima ação</legend>
            <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
              <FormField label="Data" htmlFor="lead-next-date" optional error={error("nextActionDate")}>
                <Input {...fieldAria("lead-next-date", error("nextActionDate"))} name="nextActionDate" type="date" defaultValue={lead?.nextActionDate ?? ""} />
              </FormField>
              <FormField label="Horário" htmlFor="lead-next-time" optional error={error("nextActionTime")}>
                <Input {...fieldAria("lead-next-time", error("nextActionTime"))} name="nextActionTime" type="time" defaultValue={lead?.nextActionTime ?? ""} />
              </FormField>
            </div>
            <FormField label="O que fazer" htmlFor="lead-next-note" optional error={error("nextActionNote")}>
              <Input
                {...fieldAria("lead-next-note", error("nextActionNote"))}
                name="nextActionNote"
                placeholder="Ex.: ligar para apresentar o orçamento"
                defaultValue={lead?.nextActionNote ?? ""}
                maxLength={200}
              />
            </FormField>
          </fieldset>

          <FormField
            label="Observações comerciais"
            htmlFor="lead-notes"
            optional
            error={error("notes")}
            description="Não registre informações de saúde aqui."
          >
            <Textarea {...fieldAria("lead-notes", error("notes"), true)} name="notes" rows={3} maxLength={2000} defaultValue={lead?.notes ?? ""} />
          </FormField>

          <label className="flex items-start gap-3 rounded-xl border border-border p-4 text-sm">
            <Checkbox name="whatsappOptIn" defaultChecked={lead?.whatsappOptIn ?? false} className="mt-0.5" />
            <span>
              <span className="font-medium text-foreground">Autorizou receber mensagens pelo WhatsApp</span>
              <span className="mt-0.5 block text-muted-foreground">
                Marque somente com consentimento explícito do contato. A data fica registrada.
              </span>
            </span>
          </label>

          <DialogFooter className="pt-1">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Salvando…" : lead ? "Salvar alterações" : "Cadastrar lead"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
