"use client";

import { CalendarClock, History, Pencil, RotateCcw, UserRound } from "lucide-react";
import Link from "next/link";
import { useEffect, useState, useTransition } from "react";

import { fieldAria, FormField } from "@/components/forms/form-field";
import { FormSelect } from "@/components/forms/form-select";
import { StatusBadge } from "@/components/ui-kit/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import type { AppointmentStatus } from "@/generated/prisma/enums";
import { useAction } from "@/hooks/use-action";
import { firstFieldError } from "@/lib/action-result";
import {
  APPOINTMENT_EVENT_LABELS,
  APPOINTMENT_STATUS_LABELS,
  APPOINTMENT_STATUS_TONES,
} from "@/lib/labels";
import {
  changeAppointmentStatusAction,
  getAppointmentHistoryAction,
  rescheduleAppointmentAction,
  updateAppointmentDetailsAction,
  type AppointmentHistoryEntry,
} from "@/server/actions/appointments";

import type { AgendaItem, Choice, ProcedureChoice } from "./types";

type Panel = "actions" | "cancel" | "reschedule" | "edit";

/**
 * Detalhes de um agendamento e as ações permitidas pelo status atual. As
 * regras (transições, conflitos, horário) são sempre conferidas no servidor.
 */
export function AppointmentSheet({
  item,
  open,
  onOpenChange,
  canWrite,
  professionals,
  procedures,
  timeZone,
  onRebook,
}: {
  item: AgendaItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canWrite: boolean;
  professionals: Choice[];
  procedures: ProcedureChoice[];
  timeZone: string;
  onRebook: (item: AgendaItem) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-md">
        {item ? (
          <AppointmentDetails
            key={`${item.id}-${item.status}-${item.startMinutes}-${item.dateKey}`}
            item={item}
            canWrite={canWrite}
            professionals={professionals}
            procedures={procedures}
            timeZone={timeZone}
            onClose={() => onOpenChange(false)}
            onRebook={onRebook}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function AppointmentDetails({
  item,
  canWrite,
  professionals,
  procedures,
  timeZone,
  onClose,
  onRebook,
}: {
  item: AgendaItem;
  canWrite: boolean;
  professionals: Choice[];
  procedures: ProcedureChoice[];
  timeZone: string;
  onClose: () => void;
  onRebook: (item: AgendaItem) => void;
}) {
  const [panel, setPanel] = useState<Panel>("actions");
  const active = item.status === "SCHEDULED" || item.status === "CONFIRMED";
  const closed = item.status === "CANCELLED" || item.status === "NO_SHOW";
  const subjectHref = item.subject.kind === "patient" ? `/pacientes/${item.subject.id}` : `/leads/${item.subject.id}`;

  return (
    <>
      <SheetHeader className="gap-2 border-b border-border px-6 pt-6 pb-5">
        <StatusBadge tone={APPOINTMENT_STATUS_TONES[item.status]} label={APPOINTMENT_STATUS_LABELS[item.status]} className="self-start" />
        <SheetTitle className="text-title-2">{item.subject.name}</SheetTitle>
        <SheetDescription className="tabular-nums">
          {item.dateLabel} · {item.timeLabel}
        </SheetDescription>
      </SheetHeader>

      <div className="space-y-6 px-6 py-5">
        <dl className="space-y-3 text-sm">
          <DetailRow label={item.subject.kind === "patient" ? "Paciente" : "Lead"}>
            <Link href={subjectHref} className="inline-flex items-center gap-1.5 text-primary underline-offset-4 hover:underline">
              <UserRound aria-hidden className="size-3.5" />
              Abrir {item.subject.kind === "patient" ? "ficha" : "lead"}
            </Link>
            <span className="block text-muted-foreground tabular-nums">{item.subject.phoneLabel}</span>
          </DetailRow>
          <DetailRow label="Procedimento">{item.procedure?.name ?? "Avaliação / sem procedimento"}</DetailRow>
          <DetailRow label="Profissional">{item.professional.name}</DetailRow>
          {item.linkedReturnTitle ? <DetailRow label="Retorno">{item.linkedReturnTitle}</DetailRow> : null}
          {item.notes ? <DetailRow label="Observações">{item.notes}</DetailRow> : null}
          {item.cancellationReason ? (
            <DetailRow label="Motivo">
              <span className="text-destructive">{item.cancellationReason}</span>
            </DetailRow>
          ) : null}
          {item.rescheduledTo ? <DetailRow label="Remarcado para">{item.rescheduledTo.label}</DetailRow> : null}
          {item.rescheduledFromId ? <DetailRow label="Origem">Remarcação de um agendamento anterior</DetailRow> : null}
        </dl>

        {canWrite && panel === "actions" ? (
          <div className="space-y-2.5">
            {active ? (
              <StatusActions item={item} onDone={onClose} onPanel={setPanel} />
            ) : null}
            {closed && !item.rescheduledTo ? (
              <Button variant="outline" className="w-full" onClick={() => onRebook(item)}>
                <RotateCcw aria-hidden />
                Remarcar em novo horário
              </Button>
            ) : null}
          </div>
        ) : null}

        {canWrite && panel === "cancel" ? <CancelForm item={item} onBack={() => setPanel("actions")} onDone={onClose} /> : null}
        {canWrite && panel === "reschedule" ? (
          <RescheduleForm item={item} onBack={() => setPanel("actions")} onDone={onClose} />
        ) : null}
        {canWrite && panel === "edit" ? (
          <EditForm
            item={item}
            professionals={professionals}
            procedures={procedures}
            onBack={() => setPanel("actions")}
            onDone={onClose}
          />
        ) : null}

        <Separator />
        <AppointmentHistory appointmentId={item.id} timeZone={timeZone} />
      </div>
    </>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-foreground">{children}</dd>
    </div>
  );
}

function StatusActions({
  item,
  onDone,
  onPanel,
}: {
  item: AgendaItem;
  onDone: () => void;
  onPanel: (panel: Panel) => void;
}) {
  const { run, pending } = useAction(
    (status: AppointmentStatus) => changeAppointmentStatusAction(item.id, { status }),
    { onSuccess: onDone },
  );

  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        {item.status === "SCHEDULED" ? (
          <Button disabled={pending} onClick={() => run("CONFIRMED")}>
            Confirmar
          </Button>
        ) : (
          <Button variant="outline" disabled={pending} onClick={() => run("SCHEDULED")}>
            Desfazer confirmação
          </Button>
        )}
        <Button variant="outline" disabled={pending || !item.started} onClick={() => run("COMPLETED")}>
          Concluir
        </Button>
        <Button variant="outline" disabled={pending || !item.started} onClick={() => run("NO_SHOW")}>
          Não compareceu
        </Button>
        <Button variant="outline" disabled={pending} onClick={() => onPanel("reschedule")}>
          <CalendarClock aria-hidden />
          Reagendar
        </Button>
      </div>
      {!item.started ? (
        <p className="text-xs text-muted-foreground">Comparecimento e falta podem ser registrados a partir do horário de início.</p>
      ) : null}
      <div className="flex flex-wrap gap-2 pt-1">
        <Button variant="ghost" size="sm" onClick={() => onPanel("edit")}>
          <Pencil aria-hidden />
          Editar dados
        </Button>
        <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={() => onPanel("cancel")}>
          Cancelar agendamento
        </Button>
      </div>
    </>
  );
}

function CancelForm({ item, onBack, onDone }: { item: AgendaItem; onBack: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const { run, pending, fieldErrors } = useAction(
    (value: string) => changeAppointmentStatusAction(item.id, { status: "CANCELLED", reason: value }),
    { onSuccess: onDone },
  );
  const error = firstFieldError(fieldErrors, "reason");

  return (
    <form
      noValidate
      className="space-y-4 rounded-xl border border-destructive/30 bg-destructive/[0.05] p-4"
      onSubmit={(event) => {
        event.preventDefault();
        run(reason);
      }}
    >
      <p className="text-sm text-foreground">
        O horário é liberado e o histórico é mantido. Lembretes pendentes são cancelados.
      </p>
      <FormField label="Motivo do cancelamento" htmlFor="cancel-reason" error={error}>
        <Input
          {...fieldAria("cancel-reason", error)}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          maxLength={200}
          placeholder="Ex.: paciente pediu para remarcar"
          autoFocus
        />
      </FormField>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onBack}>
          Voltar
        </Button>
        <Button type="submit" variant="destructive" disabled={pending}>
          {pending ? "Cancelando…" : "Cancelar agendamento"}
        </Button>
      </div>
    </form>
  );
}

function RescheduleForm({ item, onBack, onDone }: { item: AgendaItem; onBack: () => void; onDone: () => void }) {
  const { run, pending, fieldErrors } = useAction(rescheduleAppointmentAction.bind(null, item.id), { onSuccess: onDone });
  const error = (field: string) => firstFieldError(fieldErrors, field);

  return (
    <form
      noValidate
      className="space-y-4 rounded-xl border border-border p-4"
      onSubmit={(event) => {
        event.preventDefault();
        run(new FormData(event.currentTarget));
      }}
    >
      <p className="text-sm text-muted-foreground">
        O agendamento é mantido com o novo horário; o horário anterior fica no histórico. O novo horário precisa ser confirmado.
      </p>
      <div className="grid gap-3 sm:grid-cols-[1fr_6.5rem_6.5rem]">
        <FormField label="Nova data" htmlFor="reschedule-date" error={error("date")}>
          <Input {...fieldAria("reschedule-date", error("date"))} name="date" type="date" defaultValue={item.dateKey} />
        </FormField>
        <FormField label="Início" htmlFor="reschedule-start" error={error("startTime")}>
          <Input {...fieldAria("reschedule-start", error("startTime"))} name="startTime" type="time" step={300} defaultValue={item.startTime} />
        </FormField>
        <FormField label="Duração" htmlFor="reschedule-duration" error={error("durationMinutes")}>
          <Input
            {...fieldAria("reschedule-duration", error("durationMinutes"))}
            name="durationMinutes"
            type="number"
            min={5}
            max={720}
            step={5}
            defaultValue={item.durationMinutes}
          />
        </FormField>
      </div>
      <FormField label="Motivo" htmlFor="reschedule-reason" optional error={error("reason")}>
        <Input {...fieldAria("reschedule-reason", error("reason"))} name="reason" maxLength={300} placeholder="Ex.: pedido da paciente" />
      </FormField>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onBack}>
          Voltar
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Salvando…" : "Reagendar"}
        </Button>
      </div>
    </form>
  );
}

function EditForm({
  item,
  professionals,
  procedures,
  onBack,
  onDone,
}: {
  item: AgendaItem;
  professionals: Choice[];
  procedures: ProcedureChoice[];
  onBack: () => void;
  onDone: () => void;
}) {
  const { run, pending, fieldErrors } = useAction(updateAppointmentDetailsAction.bind(null, item.id), { onSuccess: onDone });
  const error = (field: string) => firstFieldError(fieldErrors, field);
  // Um procedimento desativado continua aparecendo se já estava no agendamento.
  const procedureOptions =
    item.procedure && !procedures.some((option) => option.value === item.procedure!.id)
      ? [...procedures, { value: item.procedure.id, label: item.procedure.name, durationMinutes: item.durationMinutes }]
      : procedures;

  return (
    <form
      noValidate
      className="space-y-4 rounded-xl border border-border p-4"
      onSubmit={(event) => {
        event.preventDefault();
        run(new FormData(event.currentTarget));
      }}
    >
      <FormField label="Profissional" htmlFor="edit-professional" error={error("professionalId")}>
        <FormSelect id="edit-professional" name="professionalId" defaultValue={item.professional.id} options={professionals} />
      </FormField>
      <FormField label="Procedimento" htmlFor="edit-procedure" optional error={error("procedureId")}>
        <FormSelect
          id="edit-procedure"
          name="procedureId"
          defaultValue={item.procedure?.id}
          emptyLabel="Avaliação / sem procedimento"
          options={procedureOptions}
        />
      </FormField>
      <FormField label="Observações" htmlFor="edit-notes" optional error={error("notes")}>
        <Textarea {...fieldAria("edit-notes", error("notes"))} name="notes" rows={2} maxLength={500} defaultValue={item.notes ?? ""} />
      </FormField>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onBack}>
          Voltar
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Salvando…" : "Salvar"}
        </Button>
      </div>
    </form>
  );
}

function AppointmentHistory({ appointmentId, timeZone }: { appointmentId: string; timeZone: string }) {
  const [entries, setEntries] = useState<AppointmentHistoryEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [, startLoading] = useTransition();

  useEffect(() => {
    let cancelled = false;
    startLoading(async () => {
      const result = await getAppointmentHistoryAction(appointmentId).catch(() => null);
      if (cancelled) return;
      if (result && result.ok) setEntries(result.data);
      else setFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, [appointmentId]);

  const formatter = new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  });
  const format = (iso: string) => formatter.format(new Date(iso));

  return (
    <section aria-labelledby="historico-agendamento">
      <h3 id="historico-agendamento" className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
        <History aria-hidden className="size-4 text-muted-foreground" />
        Histórico
      </h3>
      {failed ? <p className="text-sm text-destructive">Não foi possível carregar o histórico.</p> : null}
      {!entries && !failed ? <p className="text-sm text-muted-foreground">Carregando…</p> : null}
      {entries ? (
        <ol className="space-y-3">
          {entries.map((entry) => (
            <li key={entry.id} className="text-sm">
              <p className="text-foreground">
                {entry.type === "STATUS_CHANGED" && entry.toStatus
                  ? `${entry.fromStatus ? APPOINTMENT_STATUS_LABELS[entry.fromStatus] : "—"} → ${APPOINTMENT_STATUS_LABELS[entry.toStatus]}`
                  : APPOINTMENT_EVENT_LABELS[entry.type]}
              </p>
              {entry.type === "RESCHEDULED" && entry.previousStartsAt && entry.newStartsAt ? (
                <p className="text-xs text-muted-foreground tabular-nums">
                  De {format(entry.previousStartsAt)} para {format(entry.newStartsAt)}
                </p>
              ) : null}
              {entry.reason ? <p className="text-xs text-muted-foreground">Motivo: {entry.reason}</p> : null}
              <p className="text-xs text-muted-foreground tabular-nums">
                {format(entry.createdAt)}
                {entry.actorName ? ` · ${entry.actorName}` : ""}
              </p>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
