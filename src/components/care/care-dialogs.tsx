"use client";

import { useState, type ReactNode } from "react";

import { ConfirmDialog } from "@/components/forms/confirm-dialog";
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
import { RETURN_KIND_LABELS } from "@/lib/labels";
import {
  applyProtocolAction,
  cancelPatientProtocolAction,
  createProcedureRecordAction,
  createReturnAction,
} from "@/server/actions/care";

export interface CareProcedureOption extends SelectOption {
  suggestedReturnDays: number | null;
}

export interface CareProtocolOption {
  id: string;
  name: string;
  procedureName: string;
  stepsSummary: string;
}

function useDialogState() {
  const [open, setOpen] = useState(false);
  useResetOnHide(() => setOpen(false));
  return [open, setOpen] as const;
}

// -----------------------------------------------------------------------------
// Procedimento realizado
// -----------------------------------------------------------------------------

export function ProcedureRecordDialog({
  patientId,
  procedures,
  professionals,
  todayKey,
  trigger,
}: {
  patientId: string;
  procedures: CareProcedureOption[];
  professionals: SelectOption[];
  todayKey: string;
  trigger: ReactNode;
}) {
  const [open, setOpen] = useDialogState();
  const [procedureId, setProcedureId] = useState("");
  const { run, pending, fieldErrors, reset } = useAction(createProcedureRecordAction.bind(null, patientId), {
    onSuccess: () => setOpen(false),
  });
  const error = (field: string) => firstFieldError(fieldErrors, field);
  const suggested = procedures.find((item) => item.value === procedureId)?.suggestedReturnDays ?? null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          reset();
          setProcedureId("");
        }
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Registrar procedimento realizado</DialogTitle>
          <DialogDescription>
            Para atendimentos da agenda, basta concluir o agendamento — o registro é criado automaticamente.
          </DialogDescription>
        </DialogHeader>
        <form
          noValidate
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            run(new FormData(event.currentTarget));
          }}
        >
          <FormField label="Procedimento" htmlFor="record-procedure" error={error("procedureId")}>
            <FormSelect
              id="record-procedure"
              name="procedureId"
              value={procedureId}
              onValueChange={setProcedureId}
              options={procedures}
              placeholder="Selecione o procedimento"
              invalid={Boolean(error("procedureId"))}
            />
          </FormField>
          <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
            <FormField label="Data" htmlFor="record-date" error={error("date")}>
              <Input {...fieldAria("record-date", error("date"))} name="date" type="date" max={todayKey} defaultValue={todayKey} />
            </FormField>
            <FormField label="Horário" htmlFor="record-time" optional error={error("time")}>
              <Input {...fieldAria("record-time", error("time"))} name="time" type="time" />
            </FormField>
          </div>
          <FormField label="Profissional" htmlFor="record-professional" optional error={error("professionalId")}>
            <FormSelect id="record-professional" name="professionalId" options={professionals} emptyLabel="Não informado" />
          </FormField>
          <FormField
            label="Observações administrativas"
            htmlFor="record-notes"
            optional
            error={error("notes")}
            description="Observações clínicas ficam na aba Observações, com acesso restrito."
          >
            <Textarea {...fieldAria("record-notes", error("notes"), true)} name="notes" rows={2} maxLength={500} />
          </FormField>
          {suggested ? (
            <label className="flex items-start gap-3 rounded-xl border border-border p-3 text-sm">
              <Checkbox name="createReturn" defaultChecked className="mt-0.5" />
              <span>
                Programar retorno em {suggested} dias
                <span className="block text-xs text-muted-foreground">Intervalo definido pela profissional no cadastro do procedimento.</span>
              </span>
            </label>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Registrando…" : "Registrar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// -----------------------------------------------------------------------------
// Aplicar protocolo
// -----------------------------------------------------------------------------

export function ApplyProtocolDialog({
  patientId,
  protocols,
  professionals,
  todayKey,
  trigger,
}: {
  patientId: string;
  protocols: CareProtocolOption[];
  professionals: SelectOption[];
  todayKey: string;
  trigger: ReactNode;
}) {
  const [open, setOpen] = useDialogState();
  const [protocolId, setProtocolId] = useState("");
  const { run, pending, fieldErrors, reset } = useAction(applyProtocolAction.bind(null, patientId), {
    onSuccess: () => setOpen(false),
  });
  const error = (field: string) => firstFieldError(fieldErrors, field);
  const chosen = protocols.find((item) => item.id === protocolId);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          reset();
          setProtocolId("");
        }
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Aplicar protocolo</DialogTitle>
          <DialogDescription>
            Os retornos são programados com os intervalos definidos pela profissional no protocolo.
          </DialogDescription>
        </DialogHeader>
        {protocols.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhum protocolo ativo. Cadastre protocolos em “Protocolos e retornos”.
          </p>
        ) : (
          <form
            noValidate
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              run(new FormData(event.currentTarget));
            }}
          >
            <FormField label="Protocolo" htmlFor="apply-protocol" error={error("protocolId")}>
              <FormSelect
                id="apply-protocol"
                name="protocolId"
                value={protocolId}
                onValueChange={setProtocolId}
                options={protocols.map((item) => ({ value: item.id, label: item.name }))}
                placeholder="Selecione o protocolo"
                invalid={Boolean(error("protocolId"))}
              />
            </FormField>
            {chosen ? (
              <p className="rounded-xl border border-border bg-surface-raised/40 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
                <span className="text-foreground">{chosen.procedureName}</span> · {chosen.stepsSummary}
              </p>
            ) : null}
            <FormField label="Data de início" htmlFor="apply-start" error={error("startDate")}>
              <Input {...fieldAria("apply-start", error("startDate"))} name="startDate" type="date" defaultValue={todayKey} />
            </FormField>
            <label className="flex items-start gap-3 text-sm">
              <Checkbox name="registerInitialProcedure" className="mt-0.5" />
              <span>
                Registrar o procedimento inicial como realizado nesta data
                <span className="block text-xs text-muted-foreground">Use quando a primeira sessão já aconteceu.</span>
              </span>
            </label>
            <FormField label="Profissional" htmlFor="apply-professional" optional>
              <FormSelect id="apply-professional" name="professionalId" options={professionals} emptyLabel="Quem está registrando" />
            </FormField>
            <FormField label="Observações administrativas" htmlFor="apply-notes" optional error={error("notes")}>
              <Textarea {...fieldAria("apply-notes", error("notes"))} name="notes" rows={2} maxLength={500} />
            </FormField>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Aplicando…" : "Aplicar protocolo"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

// -----------------------------------------------------------------------------
// Retorno avulso
// -----------------------------------------------------------------------------

const RETURN_KIND_OPTIONS = (["REVIEW", "SESSION", "MAINTENANCE", "CUSTOM"] as const).map((value) => ({
  value,
  label: RETURN_KIND_LABELS[value],
}));

export function ReturnCreateDialog({
  patientId,
  procedures,
  todayKey,
  trigger,
}: {
  patientId: string;
  procedures: SelectOption[];
  todayKey: string;
  trigger: ReactNode;
}) {
  const [open, setOpen] = useDialogState();
  const { run, pending, fieldErrors, reset } = useAction(createReturnAction.bind(null, patientId), {
    onSuccess: () => setOpen(false),
  });
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
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Programar retorno</DialogTitle>
          <DialogDescription>A data é definida pela equipe ou pela profissional. Com autorização do WhatsApp, o lembrete é agendado.</DialogDescription>
        </DialogHeader>
        <form
          noValidate
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            run(new FormData(event.currentTarget));
          }}
        >
          <FormField label="Título" htmlFor="return-title" error={error("title")}>
            <Input {...fieldAria("return-title", error("title"))} name="title" maxLength={120} placeholder="Ex.: Retorno de avaliação" />
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Tipo" htmlFor="return-kind">
              <FormSelect id="return-kind" name="kind" defaultValue="REVIEW" options={RETURN_KIND_OPTIONS} />
            </FormField>
            <FormField label="Data prevista" htmlFor="return-due" error={error("dueDate")}>
              <Input {...fieldAria("return-due", error("dueDate"))} name="dueDate" type="date" min={todayKey} />
            </FormField>
          </div>
          <FormField label="Procedimento" htmlFor="return-procedure" optional>
            <FormSelect id="return-procedure" name="procedureId" options={procedures} emptyLabel="Nenhum específico" />
          </FormField>
          <FormField label="Observações administrativas" htmlFor="return-notes" optional error={error("notes")}>
            <Textarea {...fieldAria("return-notes", error("notes"))} name="notes" rows={2} maxLength={500} />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Salvando…" : "Programar retorno"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// -----------------------------------------------------------------------------
// Cancelar protocolo do paciente
// -----------------------------------------------------------------------------

export function CancelProtocolButton({ patientProtocolId, name }: { patientProtocolId: string; name: string }) {
  const [open, setOpen] = useDialogState();
  const [reason, setReason] = useState("");
  const { run, pending, fieldErrors, reset } = useAction(
    (value: string) => cancelPatientProtocolAction(patientProtocolId, value),
    {
      onSuccess: () => {
        setOpen(false);
        setReason("");
      },
    },
  );
  const error = firstFieldError(fieldErrors, "reason");

  return (
    <>
      <Button variant="ghost" size="sm" className="text-brick hover:text-brick" onClick={() => setOpen(true)}>
        Cancelar protocolo
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) reset();
        }}
        destructive
        pending={pending}
        title={`Cancelar ${name}?`}
        description="Os retornos pendentes deste protocolo são cancelados, com seus lembretes. Retornos já agendados continuam na agenda. O histórico é mantido."
        confirmLabel="Cancelar protocolo"
        onConfirm={() => run(reason)}
      >
        <FormField label="Motivo" htmlFor={`cancel-protocol-${patientProtocolId}`} error={error}>
          <Input
            {...fieldAria(`cancel-protocol-${patientProtocolId}`, error)}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={200}
          />
        </FormField>
      </ConfirmDialog>
    </>
  );
}
