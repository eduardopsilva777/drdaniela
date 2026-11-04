"use client";

import { useEffect, useState, useTransition, type ReactNode } from "react";

import { fieldAria, FormField } from "@/components/forms/form-field";
import { FormSelect } from "@/components/forms/form-select";
import { Button } from "@/components/ui/button";
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
import { cn } from "@/lib/utils";
import {
  createAppointmentAction,
  listReturnsForSchedulingAction,
  type SchedulableReturn,
} from "@/server/actions/appointments";

import { SubjectPicker, type SubjectOption } from "./subject-picker";
import type { Choice, ProcedureChoice, SubjectRef } from "./types";

export interface AppointmentDefaults {
  date: string;
  startTime?: string;
  professionalId?: string;
  procedureId?: string;
  durationMinutes?: number;
  returnId?: string;
  rescheduledFromId?: string;
  notes?: string;
}

function endTimeLabel(startTime: string, duration: number): string | null {
  const match = /^(\d{2}):(\d{2})$/.exec(startTime);
  if (!match || !Number.isFinite(duration) || duration <= 0) return null;
  const total = Number(match[1]) * 60 + Number(match[2]) + duration;
  if (total > 24 * 60) return null;
  const hours = Math.floor(total / 60) % 24;
  return `${String(hours).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * Novo agendamento (ou remarcação de um cancelado/ausente). O servidor revalida
 * tudo: conflito de horário, janela de datas, profissional e paciente ativos.
 */
export function AppointmentFormDialog({
  trigger,
  open: controlledOpen,
  onOpenChange,
  title = "Novo agendamento",
  description = "Conflitos de horário da mesma profissional são bloqueados automaticamente.",
  professionals,
  procedures,
  defaults,
  fixedSubject,
}: {
  trigger?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  title?: string;
  description?: string;
  professionals: Choice[];
  procedures: ProcedureChoice[];
  defaults: AppointmentDefaults;
  /** Paciente ou lead já definido (ficha, retorno, remarcação). */
  fixedSubject?: SubjectRef;
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = (next: boolean) => {
    if (controlledOpen === undefined) setInternalOpen(next);
    onOpenChange?.(next);
  };

  const { run, pending, fieldErrors, reset } = useAction(createAppointmentAction, { onSuccess: () => setOpen(false) });
  useResetOnHide(() => setInternalOpen(false));
  const error = (field: string) => firstFieldError(fieldErrors, field);

  const initialProcedure = defaults.procedureId ?? "";
  const [kind, setKind] = useState<"patient" | "lead">(fixedSubject?.kind ?? "patient");
  const [subject, setSubject] = useState<SubjectOption | null>(null);
  const [procedureId, setProcedureId] = useState(initialProcedure);
  const [duration, setDuration] = useState(
    String(defaults.durationMinutes ?? procedures.find((item) => item.value === initialProcedure)?.durationMinutes ?? 60),
  );
  const [durationTouched, setDurationTouched] = useState(Boolean(defaults.durationMinutes));
  const [startTime, setStartTime] = useState(defaults.startTime ?? "09:00");
  const [returnId, setReturnId] = useState(defaults.returnId ?? "");
  const [returns, setReturns] = useState<SchedulableReturn[]>([]);
  const [, startLoading] = useTransition();

  const patientId = fixedSubject?.kind === "patient" ? fixedSubject.id : kind === "patient" ? subject?.id : undefined;

  // Retornos pendentes do paciente escolhido (para vincular ao agendamento).
  useEffect(() => {
    if (!open || !patientId || defaults.rescheduledFromId) return;
    let cancelled = false;
    startLoading(async () => {
      const result = await listReturnsForSchedulingAction(patientId).catch(() => null);
      if (!cancelled) setReturns(result && result.ok ? result.data : []);
    });
    return () => {
      cancelled = true;
    };
  }, [open, patientId, defaults.rescheduledFromId]);

  function resetForm() {
    reset();
    setKind(fixedSubject?.kind ?? "patient");
    setSubject(null);
    setProcedureId(initialProcedure);
    setDuration(String(defaults.durationMinutes ?? procedures.find((item) => item.value === initialProcedure)?.durationMinutes ?? 60));
    setDurationTouched(Boolean(defaults.durationMinutes));
    setStartTime(defaults.startTime ?? "09:00");
    setReturnId(defaults.returnId ?? "");
    setReturns([]);
  }

  function chooseProcedure(value: string) {
    setProcedureId(value);
    const procedure = procedures.find((item) => item.value === value);
    if (procedure && !durationTouched) setDuration(String(procedure.durationMinutes));
  }

  function chooseReturn(value: string) {
    setReturnId(value);
    const chosen = returns.find((item) => item.id === value);
    if (chosen?.procedureId && !procedureId) chooseProcedure(chosen.procedureId);
  }

  const end = endTimeLabel(startTime, Number(duration));
  const defaultProfessional =
    defaults.professionalId ?? (professionals.length === 1 ? professionals[0]!.value : undefined);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) resetForm();
      }}
    >
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <form
          noValidate
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            const subjectKind = fixedSubject?.kind ?? kind;
            data.set("subject", subjectKind);
            data.set("patientId", subjectKind === "patient" ? (fixedSubject?.id ?? subject?.id ?? "") : "");
            data.set("leadId", subjectKind === "lead" ? (fixedSubject?.id ?? subject?.id ?? "") : "");
            data.set("returnId", returnId);
            data.set("rescheduledFromId", defaults.rescheduledFromId ?? "");
            run(data);
          }}
        >
          {fixedSubject ? (
            <div className="rounded-xl border border-border bg-surface-raised/40 px-4 py-3 text-sm">
              <span className="text-muted-foreground">{fixedSubject.kind === "patient" ? "Paciente" : "Lead"}: </span>
              <span className="font-medium text-foreground">{fixedSubject.name}</span>
            </div>
          ) : (
            <div className="space-y-3">
              <div role="radiogroup" aria-label="Agendar para" className="inline-flex rounded-lg border border-border bg-card p-0.5">
                {(["patient", "lead"] as const).map((option) => (
                  <button
                    key={option}
                    type="button"
                    role="radio"
                    aria-checked={kind === option}
                    onClick={() => {
                      setKind(option);
                      setSubject(null);
                      setReturns([]);
                      setReturnId("");
                    }}
                    className={cn(
                      "h-8 rounded-md px-3 text-sm transition-colors",
                      kind === option ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {option === "patient" ? "Paciente" : "Lead (avaliação)"}
                  </button>
                ))}
              </div>
              <FormField
                label={kind === "patient" ? "Paciente" : "Lead"}
                htmlFor="appointment-subject"
                error={error(kind === "patient" ? "patientId" : "leadId")}
              >
                <SubjectPicker
                  id="appointment-subject"
                  kind={kind}
                  value={subject}
                  onChange={(value) => {
                    setSubject(value);
                    setReturnId("");
                  }}
                  invalid={Boolean(error(kind === "patient" ? "patientId" : "leadId"))}
                />
              </FormField>
            </div>
          )}

          {returns.length > 0 ? (
            <FormField
              label="Retorno programado"
              htmlFor="appointment-return"
              optional
              error={error("returnId")}
              description="Vincule para que o comparecimento registre o retorno automaticamente."
            >
              <FormSelect
                id="appointment-return"
                name="returnIdChoice"
                value={returnId}
                onValueChange={chooseReturn}
                emptyLabel="Não vincular"
                options={returns.map((item) => ({ value: item.id, label: `${item.title} · previsto ${item.dueLabel}` }))}
              />
            </FormField>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Procedimento" htmlFor="appointment-procedure" optional error={error("procedureId")}>
              <FormSelect
                id="appointment-procedure"
                name="procedureId"
                value={procedureId}
                onValueChange={chooseProcedure}
                emptyLabel="Avaliação / sem procedimento"
                options={procedures}
              />
            </FormField>
            <FormField label="Profissional" htmlFor="appointment-professional" error={error("professionalId")}>
              <FormSelect
                id="appointment-professional"
                name="professionalId"
                defaultValue={defaultProfessional}
                options={professionals}
                placeholder="Selecione a profissional"
                invalid={Boolean(error("professionalId"))}
              />
            </FormField>
          </div>

          <div className="grid gap-4 sm:grid-cols-[1fr_7.5rem_7.5rem]">
            <FormField label="Data" htmlFor="appointment-date" error={error("date")}>
              <Input {...fieldAria("appointment-date", error("date"))} name="date" type="date" defaultValue={defaults.date} />
            </FormField>
            <FormField label="Início" htmlFor="appointment-start" error={error("startTime")}>
              <Input
                {...fieldAria("appointment-start", error("startTime"))}
                name="startTime"
                type="time"
                step={300}
                value={startTime}
                onChange={(event) => setStartTime(event.target.value)}
              />
            </FormField>
            <FormField label="Duração (min)" htmlFor="appointment-duration" error={error("durationMinutes")}>
              <Input
                {...fieldAria("appointment-duration", error("durationMinutes"))}
                name="durationMinutes"
                type="number"
                inputMode="numeric"
                min={5}
                max={720}
                step={5}
                value={duration}
                onChange={(event) => {
                  setDuration(event.target.value);
                  setDurationTouched(true);
                }}
              />
            </FormField>
          </div>
          {end && !error("startTime") ? (
            <p className="-mt-3 text-xs text-muted-foreground tabular-nums">Término previsto às {end}.</p>
          ) : null}

          <FormField
            label="Observações"
            htmlFor="appointment-notes"
            optional
            error={error("notes")}
            description="Informações administrativas (ex.: preferência de sala). Não registre dados clínicos."
          >
            <Textarea
              {...fieldAria("appointment-notes", error("notes"), true)}
              name="notes"
              rows={2}
              maxLength={500}
              defaultValue={defaults.notes ?? ""}
            />
          </FormField>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Agendando…" : "Agendar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
