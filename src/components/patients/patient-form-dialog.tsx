"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";

import { fieldAria, FormField } from "@/components/forms/form-field";
import { FormSelect } from "@/components/forms/form-select";
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
import { useAction } from "@/hooks/use-action";
import { useResetOnHide } from "@/hooks/use-reset-on-hide";
import { firstFieldError } from "@/lib/action-result";
import { LEAD_SOURCE_LABELS } from "@/lib/labels";
import { savePatientAction } from "@/server/actions/patients";

export interface PatientFormValues {
  id: string;
  fullName: string;
  preferredName: string | null;
  phone: string;
  email: string | null;
  birthDate: string | null;
  source: string | null;
  sourceDetail: string | null;
  whatsappOptIn: boolean;
  marketingOptIn: boolean;
  imageUseConsent: boolean;
}

const SOURCE_OPTIONS = Object.entries(LEAD_SOURCE_LABELS).map(([value, label]) => ({ value, label }));

const CONSENTS = [
  {
    name: "whatsappOptIn",
    title: "Mensagens pelo WhatsApp",
    description: "Lembretes de agendamento e de retorno, e conversas com a equipe.",
  },
  {
    name: "marketingOptIn",
    title: "Comunicações promocionais",
    description: "Novidades e campanhas da clínica.",
  },
  {
    name: "imageUseConsent",
    title: "Uso de imagem",
    description: "Uso de fotos em materiais da clínica, conforme termo assinado.",
  },
] as const;

export function PatientFormDialog({ patient, trigger }: { patient?: PatientFormValues; trigger: ReactNode }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const action = savePatientAction.bind(null, patient?.id ?? null);
  const { run, pending, fieldErrors, meta, reset } = useAction(action, {
    onSuccess: ({ id }) => {
      setOpen(false);
      if (!patient) router.push(`/pacientes/${id}`);
    },
  });
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
          <DialogTitle>{patient ? "Editar cadastro" : "Novo paciente"}</DialogTitle>
          <DialogDescription>
            Cadastre apenas o necessário para o atendimento. Consentimentos ficam registrados com data.
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
            <FormField label="Nome completo" htmlFor="patient-name" error={error("fullName")}>
              <Input {...fieldAria("patient-name", error("fullName"))} name="fullName" defaultValue={patient?.fullName} maxLength={120} autoFocus />
            </FormField>
            <FormField label="Como prefere ser chamada(o)" htmlFor="patient-preferred" optional error={error("preferredName")}>
              <Input {...fieldAria("patient-preferred", error("preferredName"))} name="preferredName" defaultValue={patient?.preferredName ?? ""} maxLength={60} />
            </FormField>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Telefone (com DDD)" htmlFor="patient-phone" error={error("phone")}>
              <Input
                {...fieldAria("patient-phone", error("phone"))}
                name="phone"
                type="tel"
                inputMode="tel"
                placeholder="(11) 98765-4321"
                defaultValue={patient?.phone}
                maxLength={32}
              />
            </FormField>
            <FormField label="E-mail" htmlFor="patient-email" optional error={error("email")}>
              <Input {...fieldAria("patient-email", error("email"))} name="email" type="email" defaultValue={patient?.email ?? ""} maxLength={254} />
            </FormField>
          </div>
          {meta?.existingPatientId ? (
            <div className="-mt-2 space-y-2 rounded-xl border border-warning/30 bg-warning/[0.06] p-3 text-sm">
              <Link href={`/pacientes/${meta.existingPatientId}`} className="text-primary underline underline-offset-4">
                Abrir o cadastro existente
              </Link>
              <label className="flex items-start gap-2.5">
                <Checkbox name="allowDuplicatePhone" className="mt-0.5" />
                <span>É outra pessoa com o mesmo telefone (ex.: telefone do responsável).</span>
              </label>
            </div>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-3">
            <FormField label="Nascimento" htmlFor="patient-birth" optional error={error("birthDate")}>
              <Input {...fieldAria("patient-birth", error("birthDate"))} name="birthDate" type="date" defaultValue={patient?.birthDate ?? ""} />
            </FormField>
            <FormField label="Origem" htmlFor="patient-source" optional error={error("source")}>
              <FormSelect id="patient-source" name="source" options={SOURCE_OPTIONS} defaultValue={patient?.source} emptyLabel="Não informada" />
            </FormField>
            <FormField label="Complemento" htmlFor="patient-source-detail" optional error={error("sourceDetail")}>
              <Input {...fieldAria("patient-source-detail", error("sourceDetail"))} name="sourceDetail" defaultValue={patient?.sourceDetail ?? ""} maxLength={120} />
            </FormField>
          </div>

          <fieldset className="space-y-3 rounded-xl border border-border p-4">
            <legend className="px-1 text-[0.8125rem] font-medium">Consentimentos</legend>
            <p className="text-xs text-muted-foreground">
              Marque somente o que o paciente autorizou de forma explícita. Alterações ficam na auditoria.
            </p>
            {CONSENTS.map((consent) => (
              <label key={consent.name} className="flex items-start gap-3 text-sm">
                <Checkbox name={consent.name} defaultChecked={patient?.[consent.name] ?? false} className="mt-0.5" />
                <span>
                  <span className="font-medium text-foreground">{consent.title}</span>
                  <span className="block text-muted-foreground">{consent.description}</span>
                </span>
              </label>
            ))}
          </fieldset>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Salvando…" : patient ? "Salvar alterações" : "Cadastrar paciente"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
