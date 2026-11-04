import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { AgendaView, type AgendaDay } from "@/components/agenda/agenda-view";
import { AppointmentFormDialog } from "@/components/agenda/appointment-form-dialog";
import type { AgendaItem } from "@/components/agenda/types";
import { SegmentedFilter, SelectFilter } from "@/components/data/url-filters";
import { AccessDenied } from "@/components/layout/access-denied";
import { PageContainer, PageHeader } from "@/components/layout/page";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { hasPermission } from "@/lib/auth/permissions";
import {
  addDaysToKey,
  addMonthsToKey,
  dateKeyOf,
  dayRange,
  formatKeyDayMonth,
  formatKeyDayMonthLong,
  formatKeyMonthYear,
  formatKeyWeekdayLong,
  formatKeyWeekdayShort,
  minutesOfDay,
  monthGridRange,
  startOfMonthKey,
  timeOf,
  todayKey,
  weekRange,
  type DateKey,
} from "@/lib/datetime";
import { formatDateTime } from "@/lib/format";
import { APPOINTMENT_STATUS_LABELS } from "@/lib/labels";
import { formatPhone } from "@/lib/phone";
import { cn } from "@/lib/utils";
import { agendaFiltersSchema, type AgendaFilters } from "@/lib/validation/appointments";
import { checkPermission } from "@/server/auth/dal";
import { getServerEnv } from "@/server/env";
import { getAgendaAppointments, type AgendaAppointment } from "@/server/queries/agenda";
import { getActiveProcedureOptions, getProfessionalOptions } from "@/server/queries/catalog";

export const metadata: Metadata = { title: "Agenda" };

export default function AgendaPage(props: PageProps<"/agenda">) {
  return (
    <PageContainer className="max-w-[100rem]">
      <PageHeader
        title="Agenda"
        description="Horários da clínica por dia, semana e mês. Toque em um horário livre para agendar; conflitos da mesma profissional são bloqueados."
      />
      <Suspense fallback={<AgendaSkeleton />}>
        <AgendaContent searchParams={props.searchParams} />
      </Suspense>
    </PageContainer>
  );
}

function AgendaSkeleton() {
  return (
    <div className="space-y-4" aria-hidden>
      <Skeleton className="h-9 w-full max-w-3xl" />
      <Skeleton className="h-[32rem] w-full rounded-2xl" />
    </div>
  );
}

function hrefFor(filters: AgendaFilters, changes: Partial<AgendaFilters>, today: DateKey): string {
  const next = { ...filters, ...changes };
  const params = new URLSearchParams();
  if (next.data && next.data !== today) params.set("data", next.data);
  if (next.visao !== "semana") params.set("visao", next.visao);
  if (next.profissional) params.set("profissional", next.profissional);
  if (next.status) params.set("status", next.status);
  const query = params.toString();
  return query ? `/agenda?${query}` : "/agenda";
}

function shift(filters: AgendaFilters, anchor: DateKey, direction: 1 | -1): DateKey {
  if (filters.visao === "dia") return addDaysToKey(anchor, direction);
  if (filters.visao === "semana") return addDaysToKey(anchor, 7 * direction);
  return addMonthsToKey(startOfMonthKey(anchor), direction);
}

function rangeTitle(filters: AgendaFilters, anchor: DateKey, days: DateKey[]): string {
  if (filters.visao === "dia") return `${formatKeyWeekdayLong(anchor)}, ${formatKeyDayMonthLong(anchor)}`;
  if (filters.visao === "mes") return formatKeyMonthYear(anchor);
  const first = days[0]!;
  const last = days.at(-1)!;
  const sameMonth = first.slice(0, 7) === last.slice(0, 7);
  const year = last.slice(0, 4);
  return sameMonth
    ? `${Number(first.slice(8))} a ${formatKeyDayMonthLong(last)} de ${year}`
    : `${formatKeyDayMonthLong(first)} a ${formatKeyDayMonthLong(last)} de ${year}`;
}

function toAgendaItem(row: AgendaAppointment, timeZone: string, now: Date): AgendaItem {
  const dateKey = dateKeyOf(row.startsAt, timeZone);
  const durationMinutes = Math.round((row.endsAt.getTime() - row.startsAt.getTime()) / 60_000);
  const startMinutes = minutesOfDay(row.startsAt, timeZone);
  return {
    id: row.id,
    dateKey,
    startMinutes,
    endMinutes: Math.min(startMinutes + durationMinutes, 24 * 60),
    durationMinutes,
    startTime: timeOf(row.startsAt, timeZone),
    timeLabel: `${timeOf(row.startsAt, timeZone)}–${timeOf(row.endsAt, timeZone)}`,
    dateLabel: `${formatKeyWeekdayLong(dateKey)}, ${formatKeyDayMonthLong(dateKey)}`,
    status: row.status,
    subject: { ...row.subject, phoneLabel: formatPhone(row.subject.phone) },
    professional: row.professional,
    procedure: row.procedure ? { id: row.procedure.id, name: row.procedure.name } : null,
    color: row.procedure?.color ?? null,
    notes: row.notes,
    cancellationReason: row.cancellationReason,
    rescheduledFromId: row.rescheduledFromId,
    rescheduledTo: row.rescheduledTo ? { id: row.rescheduledTo.id, label: formatDateTime(row.rescheduledTo.startsAt, timeZone) } : null,
    linkedReturnTitle: row.linkedReturn?.title ?? null,
    started: row.startsAt.getTime() <= now.getTime() + 15 * 60 * 1000,
  };
}

async function AgendaContent({ searchParams }: { searchParams: PageProps<"/agenda">["searchParams"] }) {
  const { user, allowed } = await checkPermission("appointments:read");
  if (!allowed) return <AccessDenied resource="a agenda" />;

  const filters = agendaFiltersSchema.parse(await searchParams);
  const timeZone = getServerEnv().APP_TIMEZONE;
  const now = new Date();
  const today = todayKey(timeZone, now);
  const anchor = filters.data ?? today;
  const range =
    filters.visao === "dia"
      ? dayRange(anchor, timeZone)
      : filters.visao === "semana"
        ? weekRange(anchor, timeZone)
        : monthGridRange(anchor, timeZone);

  const [appointments, professionals, procedures] = await Promise.all([
    getAgendaAppointments({ start: range.start, end: range.end, professionalId: filters.profissional, status: filters.status }),
    getProfessionalOptions(),
    getActiveProcedureOptions(),
  ]);

  const canWrite = hasPermission(user.role, "appointments:write");
  const professionalChoices = professionals.map((item) => ({ value: item.id, label: item.name }));
  const procedureChoices = procedures.map((item) => ({ value: item.id, label: item.name, durationMinutes: item.durationMinutes }));
  const items = appointments.map((row) => toAgendaItem(row, timeZone, now));
  const days: AgendaDay[] = range.days.map((key) => ({
    key,
    weekday: formatKeyWeekdayShort(key),
    label: filters.visao === "dia" ? formatKeyDayMonthLong(key) : formatKeyDayMonth(key),
    dayNumber: String(Number(key.slice(8))),
    isToday: key === today,
    isPast: key < today,
    inMonth: key.slice(0, 7) === anchor.slice(0, 7),
    href: hrefFor(filters, { visao: "dia", data: key }, today),
  }));
  const active = items.filter((item) => item.status !== "CANCELLED").length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="flex items-center gap-1">
          <Link href={hrefFor(filters, { data: undefined }, today)} className={buttonVariants({ variant: "outline" })}>
            Hoje
          </Link>
          <Link
            href={hrefFor(filters, { data: shift(filters, anchor, -1) }, today)}
            aria-label="Período anterior"
            className={buttonVariants({ variant: "ghost", size: "icon" })}
          >
            <ChevronLeft aria-hidden />
          </Link>
          <Link
            href={hrefFor(filters, { data: shift(filters, anchor, 1) }, today)}
            aria-label="Próximo período"
            className={buttonVariants({ variant: "ghost", size: "icon" })}
          >
            <ChevronRight aria-hidden />
          </Link>
        </div>
        <h2 className="min-w-0 text-base font-medium text-foreground sm:text-lg" aria-live="polite">
          {rangeTitle(filters, anchor, range.days)}
        </h2>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <SegmentedFilter
            param="visao"
            label="Visualização"
            defaultValue="semana"
            options={[
              { value: "dia", label: "Dia" },
              { value: "semana", label: "Semana" },
              { value: "mes", label: "Mês" },
            ]}
          />
          {canWrite ? (
            <AppointmentFormDialog
              professionals={professionalChoices}
              procedures={procedureChoices}
              defaults={{ date: anchor >= today ? anchor : today, professionalId: filters.profissional }}
              trigger={
                <Button>
                  <Plus aria-hidden />
                  Novo agendamento
                </Button>
              }
            />
          ) : null}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        <SelectFilter
          param="profissional"
          label="Filtrar por profissional"
          allLabel="Todas as profissionais"
          options={professionalChoices}
        />
        <SelectFilter
          param="status"
          label="Filtrar por status"
          allLabel="Todos os status ativos"
          options={Object.entries(APPOINTMENT_STATUS_LABELS).map(([value, label]) => ({ value, label }))}
        />
        <p className={cn("text-sm text-muted-foreground tabular-nums", "sm:ml-auto")}>
          {active} {active === 1 ? "agendamento" : "agendamentos"} no período
          {filters.status ? "" : " · cancelados ocultos"}
        </p>
      </div>

      {professionals.length === 0 ? (
        <p className="rounded-xl border border-champagne/30 bg-champagne/[0.06] px-4 py-3 text-sm text-foreground">
          Nenhuma profissional ativa cadastrada. Agendamentos precisam de uma conta com perfil Profissional ou Administração.
        </p>
      ) : null}

      <AgendaView
        view={filters.visao}
        days={days}
        items={items}
        nowMinutes={minutesOfDay(now, timeZone)}
        canWrite={canWrite}
        professionals={professionalChoices}
        procedures={procedureChoices}
        timeZone={timeZone}
        todayKey={today}
        defaultProfessionalId={filters.profissional}
      />
    </div>
  );
}
