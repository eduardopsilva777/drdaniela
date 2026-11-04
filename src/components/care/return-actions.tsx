"use client";

import { CalendarPlus, ChevronDown } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { AppointmentFormDialog } from "@/components/agenda/appointment-form-dialog";
import type { Choice, ProcedureChoice } from "@/components/agenda/types";
import { ConfirmDialog } from "@/components/forms/confirm-dialog";
import { fieldAria, FormField } from "@/components/forms/form-field";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import type { ReturnStatus } from "@/generated/prisma/enums";
import { useAction } from "@/hooks/use-action";
import { useResetOnHide } from "@/hooks/use-reset-on-hide";
import { firstFieldError } from "@/lib/action-result";
import { resolveReturnAction, updateReturnAction } from "@/server/actions/care";
import { cancelReminderAction, retryReminderAction } from "@/server/actions/messaging";

export interface ReturnRow {
  id: string;
  title: string;
  status: ReturnStatus;
  dueKey: string;
  procedureId: string | null;
  appointmentDateKey: string | null;
}

type Pending = "completed" | "reschedule" | "missed" | "cancel" | "schedule" | null;

/**
 * Ações de um retorno. Retornos agendados são resolvidos pela agenda (para
 * agenda e retorno não divergirem); os demais aqui mesmo.
 */
export function ReturnActions({
  item,
  patient,
  todayKey,
  canSchedule,
  professionals,
  procedures,
}: {
  item: ReturnRow;
  patient: { id: string; name: string };
  todayKey: string;
  canSchedule: boolean;
  professionals: Choice[];
  procedures: ProcedureChoice[];
}) {
  const [dialog, setDialog] = useState<Pending>(null);
  useResetOnHide(() => setDialog(null));
  const close = () => setDialog(null);

  const resolve = useAction(
    (status: "COMPLETED" | "MISSED" | "CANCELLED", date?: string) => resolveReturnAction(item.id, { status, date }),
    { onSuccess: close },
  );

  if (item.status === "SCHEDULED") {
    return item.appointmentDateKey ? (
      <Link
        href={`/agenda?visao=dia&data=${item.appointmentDateKey}`}
        className={buttonVariants({ variant: "ghost", size: "sm" })}
      >
        Ver na agenda
      </Link>
    ) : null;
  }
  if (item.status !== "PENDING" && item.status !== "MISSED") return null;

  return (
    <div className="flex flex-wrap justify-end gap-1">
      {canSchedule ? (
        <Button variant="outline" size="sm" onClick={() => setDialog("schedule")}>
          <CalendarPlus aria-hidden />
          Agendar
        </Button>
      ) : null}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" aria-label={`Mais ações para ${item.title}`}>
            Registrar
            <ChevronDown aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-52">
          <DropdownMenuItem onSelect={() => setDialog("completed")}>Paciente compareceu</DropdownMenuItem>
          {item.status === "PENDING" ? (
            <DropdownMenuItem onSelect={() => setDialog("missed")}>Paciente não compareceu</DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onSelect={() => setDialog("reschedule")}>Definir nova data</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setDialog("cancel")}>
            Cancelar retorno
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {dialog === "schedule" ? (
        <AppointmentFormDialog
          open
          onOpenChange={(open) => {
            if (!open) close();
          }}
          title={`Agendar: ${item.title}`}
          professionals={professionals}
          procedures={procedures}
          fixedSubject={{ kind: "patient", id: patient.id, name: patient.name }}
          defaults={{
            date: item.dueKey < todayKey ? todayKey : item.dueKey,
            procedureId: item.procedureId ?? undefined,
            returnId: item.id,
          }}
        />
      ) : null}

      {dialog === "completed" ? (
        <AttendanceDialog
          title={`${item.title}: paciente compareceu`}
          todayKey={todayKey}
          pending={resolve.pending}
          error={firstFieldError(resolve.fieldErrors, "date")}
          onCancel={close}
          onConfirm={(date) => resolve.run("COMPLETED", date)}
        />
      ) : null}

      {dialog === "reschedule" ? <NewDateDialog item={item} todayKey={todayKey} onClose={close} /> : null}

      <ConfirmDialog
        open={dialog === "missed"}
        onOpenChange={(open) => !open && close()}
        title="Registrar que o paciente não compareceu?"
        description="O retorno fica marcado como não comparecido e pode receber uma nova data depois."
        confirmLabel="Registrar ausência"
        pending={resolve.pending}
        onConfirm={() => resolve.run("MISSED")}
      />
      <ConfirmDialog
        open={dialog === "cancel"}
        onOpenChange={(open) => !open && close()}
        destructive
        title={`Cancelar ${item.title}?`}
        description="O retorno e o lembrete pendente são cancelados. O registro continua no histórico."
        confirmLabel="Cancelar retorno"
        pending={resolve.pending}
        onConfirm={() => resolve.run("CANCELLED")}
      />
    </div>
  );
}

function AttendanceDialog({
  title,
  todayKey,
  pending,
  error,
  onCancel,
  onConfirm,
}: {
  title: string;
  todayKey: string;
  pending: boolean;
  error?: string;
  onCancel: () => void;
  onConfirm: (date: string) => void;
}) {
  const [date, setDate] = useState(todayKey);
  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Etapas seguintes do protocolo, contadas a partir desta, são recalculadas.</DialogDescription>
        </DialogHeader>
        <form
          noValidate
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            onConfirm(date);
          }}
        >
          <FormField label="Data do comparecimento" htmlFor="attendance-date" error={error}>
            <Input
              {...fieldAria("attendance-date", error)}
              type="date"
              max={todayKey}
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onCancel}>
              Voltar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Salvando…" : "Registrar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function NewDateDialog({ item, todayKey, onClose }: { item: ReturnRow; todayKey: string; onClose: () => void }) {
  const { run, pending, fieldErrors } = useAction(updateReturnAction.bind(null, item.id), { onSuccess: onClose });
  const error = (field: string) => firstFieldError(fieldErrors, field);
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Nova data para {item.title}</DialogTitle>
          <DialogDescription>O lembrete pendente é substituído pelo da nova data.</DialogDescription>
        </DialogHeader>
        <form
          noValidate
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            run(new FormData(event.currentTarget));
          }}
        >
          <FormField label="Data prevista" htmlFor="return-new-date" error={error("dueDate")}>
            <Input
              {...fieldAria("return-new-date", error("dueDate"))}
              name="dueDate"
              type="date"
              min={todayKey}
              defaultValue={item.dueKey < todayKey ? todayKey : item.dueKey}
            />
          </FormField>
          <FormField label="Observação" htmlFor="return-new-notes" optional error={error("notes")}>
            <Input {...fieldAria("return-new-notes", error("notes"))} name="notes" maxLength={500} />
          </FormField>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Voltar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Salvando…" : "Salvar data"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Cancelar (pendente/falha) ou recolocar na fila (falha) um lembrete. */
export function ReminderActions({ reminderId, status }: { reminderId: string; status: string }) {
  const cancel = useAction(cancelReminderAction);
  const retry = useAction(retryReminderAction);
  if (status !== "PENDING" && status !== "FAILED") return null;
  return (
    <div className="flex justify-end gap-1">
      {status === "FAILED" ? (
        <Button variant="ghost" size="sm" disabled={retry.pending} onClick={() => retry.run(reminderId)}>
          Tentar de novo
        </Button>
      ) : null}
      <Button variant="ghost" size="sm" disabled={cancel.pending} onClick={() => cancel.run(reminderId)}>
        Cancelar
      </Button>
    </div>
  );
}
