"use client";

import { Check } from "lucide-react";
import Link from "next/link";
import { useMemo, useState, type CSSProperties } from "react";

import { StatusBadge } from "@/components/ui-kit/status-badge";
import { useResetOnHide } from "@/hooks/use-reset-on-hide";
import { layoutDayItems, visibleHourRange } from "@/lib/agenda-layout";
import { APPOINTMENT_STATUS_LABELS, APPOINTMENT_STATUS_TONES } from "@/lib/labels";
import { cn } from "@/lib/utils";

import { AppointmentFormDialog, type AppointmentDefaults } from "./appointment-form-dialog";
import { AppointmentSheet } from "./appointment-sheet";
import type { AgendaItem, Choice, ProcedureChoice, SubjectRef } from "./types";

export interface AgendaDay {
  key: string;
  weekday: string;
  label: string;
  dayNumber: string;
  isToday: boolean;
  isPast: boolean;
  inMonth: boolean;
  /** Link para a visão diária deste dia (preserva os filtros). */
  href: string;
}

const DEFAULT_COLOR = "#e8abb1";

function blockStyle(item: AgendaItem): CSSProperties {
  const color = item.color ?? DEFAULT_COLOR;
  if (item.status === "CANCELLED" || item.status === "NO_SHOW") return { borderLeftColor: color };
  return { borderLeftColor: color, backgroundColor: `${color}24` };
}

function minutesLabel(total: number): string {
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export function AgendaView({
  view,
  days,
  items,
  nowMinutes,
  canWrite,
  professionals,
  procedures,
  timeZone,
  todayKey,
  defaultProfessionalId,
}: {
  view: "dia" | "semana" | "mes";
  days: AgendaDay[];
  items: AgendaItem[];
  nowMinutes: number;
  canWrite: boolean;
  professionals: Choice[];
  procedures: ProcedureChoice[];
  timeZone: string;
  todayKey: string;
  defaultProfessionalId?: string;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [create, setCreate] = useState<{ defaults: AppointmentDefaults; subject?: SubjectRef; title?: string } | null>(null);
  useResetOnHide(() => {
    setSheetOpen(false);
    setCreate(null);
  });

  // O item selecionado é relido a cada renderização: após uma ação, o servidor
  // devolve os dados atualizados e o painel reflete o novo status.
  const selected = items.find((item) => item.id === selectedId) ?? null;

  function openItem(item: AgendaItem) {
    setSelectedId(item.id);
    setSheetOpen(true);
  }

  function openSlot(dateKey: string, minutes: number) {
    if (!canWrite) return;
    setCreate({
      defaults: {
        date: dateKey,
        startTime: minutesLabel(minutes),
        professionalId: defaultProfessionalId,
      },
    });
  }

  function rebook(item: AgendaItem) {
    setSheetOpen(false);
    setCreate({
      title: "Remarcar agendamento",
      subject: { kind: item.subject.kind, id: item.subject.id, name: item.subject.name },
      defaults: {
        date: item.dateKey < todayKey ? todayKey : item.dateKey,
        startTime: item.startTime,
        professionalId: item.professional.id,
        procedureId: item.procedure?.id,
        durationMinutes: item.durationMinutes,
        rescheduledFromId: item.id,
      },
    });
  }

  return (
    <>
      {view === "mes" ? (
        <MonthGrid days={days} items={items} onOpen={openItem} />
      ) : (
        <>
          <div className={cn(view === "semana" && "hidden md:block")}>
            <TimeGrid
              days={days}
              items={items}
              nowMinutes={nowMinutes}
              compact={view === "semana"}
              canWrite={canWrite}
              onOpen={openItem}
              onSlot={openSlot}
            />
          </div>
          {view === "semana" ? (
            <div className="md:hidden">
              <DayList days={days} items={items} onOpen={openItem} />
            </div>
          ) : null}
        </>
      )}

      <AppointmentSheet
        item={selected}
        open={sheetOpen && Boolean(selected)}
        onOpenChange={setSheetOpen}
        canWrite={canWrite}
        professionals={professionals}
        procedures={procedures}
        timeZone={timeZone}
        onRebook={rebook}
      />

      {create ? (
        <AppointmentFormDialog
          key={JSON.stringify(create.defaults)}
          open
          onOpenChange={(open) => {
            if (!open) setCreate(null);
          }}
          title={create.title}
          professionals={professionals}
          procedures={procedures}
          defaults={create.defaults}
          fixedSubject={create.subject}
        />
      ) : null}
    </>
  );
}

// -----------------------------------------------------------------------------
// Grade de horários (dia e semana)
// -----------------------------------------------------------------------------

function TimeGrid({
  days,
  items,
  nowMinutes,
  compact,
  canWrite,
  onOpen,
  onSlot,
}: {
  days: AgendaDay[];
  items: AgendaItem[];
  nowMinutes: number;
  compact: boolean;
  canWrite: boolean;
  onOpen: (item: AgendaItem) => void;
  onSlot: (dateKey: string, minutes: number) => void;
}) {
  const hourHeight = compact ? 52 : 64;
  const perMinute = hourHeight / 60;
  const { startHour, endHour } = useMemo(
    () => visibleHourRange(items.map((item) => ({ start: item.startMinutes, end: item.endMinutes }))),
    [items],
  );
  const hours = Array.from({ length: endHour - startHour }, (_, index) => startHour + index);
  const height = hours.length * hourHeight;

  const byDay = useMemo(() => {
    const map = new Map<string, AgendaItem[]>();
    for (const item of items) map.set(item.dateKey, [...(map.get(item.dateKey) ?? []), item]);
    return map;
  }, [items]);

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="overflow-x-auto">
        <div className={cn(compact ? "min-w-[52rem]" : "min-w-0")}>
          <div
            className="grid border-b border-border"
            style={{ gridTemplateColumns: `3.5rem repeat(${days.length}, minmax(0, 1fr))` }}
          >
            <div />
            {days.map((day) => (
              <div key={day.key} className="border-l border-border px-2 py-2.5 text-center">
                <Link
                  href={day.href}
                  className={cn(
                    "inline-flex flex-col items-center rounded-lg px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground",
                    day.isToday && "text-rose",
                  )}
                >
                  <span>{day.weekday}</span>
                  <span className={cn("text-base text-foreground tabular-nums", day.isToday && "text-rose")}>{day.label}</span>
                </Link>
              </div>
            ))}
          </div>

          <div className="relative grid" style={{ gridTemplateColumns: `3.5rem repeat(${days.length}, minmax(0, 1fr))` }}>
            <div className="relative" style={{ height }} aria-hidden>
              {hours.map((hour, index) => (
                <span
                  key={hour}
                  className="absolute right-2 -translate-y-1/2 text-[0.6875rem] text-muted-foreground tabular-nums"
                  style={{ top: index * hourHeight }}
                >
                  {index === 0 ? "" : `${String(hour).padStart(2, "0")}:00`}
                </span>
              ))}
            </div>

            {days.map((day) => {
              const dayItems = byDay.get(day.key) ?? [];
              const layout = layoutDayItems(dayItems.map((item) => ({ id: item.id, start: item.startMinutes, end: item.endMinutes })));
              const showNow = day.isToday && nowMinutes >= startHour * 60 && nowMinutes <= endHour * 60;
              return (
                <div key={day.key} className={cn("relative border-l border-border", day.isPast && "bg-background/35")} style={{ height }}>
                  {hours.map((hour, index) => (
                    <div key={hour} className="absolute inset-x-0 border-t border-border/70" style={{ top: index * hourHeight }} aria-hidden>
                      {[0, 30].map((minute) => (
                        <div
                          key={minute}
                          aria-hidden
                          className={cn(
                            "h-1/2",
                            minute === 30 && "border-t border-dashed border-border/40",
                            canWrite && !day.isPast && "cursor-pointer hover:bg-rose/[0.05]",
                          )}
                          style={{ height: hourHeight / 2 }}
                          onClick={() => {
                            if (!day.isPast) onSlot(day.key, hour * 60 + minute);
                          }}
                        />
                      ))}
                    </div>
                  ))}

                  {showNow ? (
                    <div
                      aria-hidden
                      className="pointer-events-none absolute inset-x-0 z-20 h-px bg-rose"
                      style={{ top: (nowMinutes - startHour * 60) * perMinute }}
                    >
                      <span className="absolute -top-1 -left-1 size-2 rounded-full bg-rose" />
                    </div>
                  ) : null}

                  {dayItems.map((item) => {
                    const placement = layout.get(item.id) ?? { column: 0, columns: 1 };
                    const top = (item.startMinutes - startHour * 60) * perMinute;
                    const blockHeight = Math.max((item.endMinutes - item.startMinutes) * perMinute, 22);
                    const muted = item.status === "CANCELLED" || item.status === "NO_SHOW";
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => onOpen(item)}
                        aria-label={`${item.timeLabel}, ${item.subject.name}, ${APPOINTMENT_STATUS_LABELS[item.status]}`}
                        className={cn(
                          "absolute z-10 overflow-hidden rounded-md border border-l-[3px] border-border/60 px-1.5 py-1 text-left text-xs leading-tight shadow-sm transition-[filter] outline-none hover:brightness-110 focus-visible:ring-2 focus-visible:ring-ring",
                          muted ? "bg-muted/70 text-muted-foreground" : "text-foreground",
                        )}
                        style={{
                          ...blockStyle(item),
                          top,
                          height: blockHeight,
                          left: `calc(${(placement.column / placement.columns) * 100}% + 2px)`,
                          width: `calc(${100 / placement.columns}% - 4px)`,
                        }}
                      >
                        <span className="flex items-center gap-1 font-medium">
                          {item.status === "CONFIRMED" ? <Check aria-hidden className="size-3 shrink-0 text-sage" /> : null}
                          <span className={cn("truncate", item.status === "CANCELLED" && "line-through")}>{item.subject.name}</span>
                        </span>
                        {blockHeight >= 34 ? (
                          <span className="block truncate text-[0.6875rem] text-muted-foreground tabular-nums">
                            {item.timeLabel}
                            {item.procedure ? ` · ${item.procedure.name}` : ""}
                          </span>
                        ) : null}
                        {!compact && blockHeight >= 50 ? (
                          <span className="block truncate text-[0.6875rem] text-muted-foreground">
                            {item.professional.name}
                            {item.status !== "SCHEDULED" ? ` · ${APPOINTMENT_STATUS_LABELS[item.status]}` : ""}
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Lista por dia (semana no celular)
// -----------------------------------------------------------------------------

function DayList({ days, items, onOpen }: { days: AgendaDay[]; items: AgendaItem[]; onOpen: (item: AgendaItem) => void }) {
  return (
    <div className="space-y-4">
      {days.map((day) => {
        const dayItems = items.filter((item) => item.dateKey === day.key);
        return (
          <section key={day.key} aria-label={`${day.weekday} ${day.label}`} className="rounded-2xl border border-border bg-card">
            <header className="flex items-baseline justify-between border-b border-border px-4 py-2.5">
              <Link href={day.href} className={cn("text-sm font-medium", day.isToday ? "text-rose" : "text-foreground")}>
                {day.weekday}, {day.label}
              </Link>
              <span className="text-xs text-muted-foreground tabular-nums">{dayItems.length}</span>
            </header>
            {dayItems.length === 0 ? (
              <p className="px-4 py-3 text-sm text-muted-foreground">Sem agendamentos.</p>
            ) : (
              <ul className="divide-y divide-border">
                {dayItems.map((item) => (
                  <li key={item.id}>
                    <button type="button" onClick={() => onOpen(item)} className="flex w-full items-start gap-3 px-4 py-3 text-left">
                      <span
                        aria-hidden
                        className="mt-1.5 size-2 shrink-0 rounded-full"
                        style={{ backgroundColor: item.color ?? DEFAULT_COLOR }}
                      />
                      <span className="min-w-0 flex-1">
                        <span className={cn("block truncate text-sm text-foreground", item.status === "CANCELLED" && "line-through")}>
                          {item.subject.name}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground tabular-nums">
                          {item.timeLabel} · {item.procedure?.name ?? "Avaliação"} · {item.professional.name}
                        </span>
                      </span>
                      <StatusBadge tone={APPOINTMENT_STATUS_TONES[item.status]} label={APPOINTMENT_STATUS_LABELS[item.status]} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Mês
// -----------------------------------------------------------------------------

const WEEKDAYS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
const MAX_PER_DAY = 3;

function MonthGrid({ days, items, onOpen }: { days: AgendaDay[]; items: AgendaItem[]; onOpen: (item: AgendaItem) => void }) {
  const byDay = useMemo(() => {
    const map = new Map<string, AgendaItem[]>();
    for (const item of items) map.set(item.dateKey, [...(map.get(item.dateKey) ?? []), item]);
    return map;
  }, [items]);

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="grid grid-cols-7 border-b border-border">
        {WEEKDAYS.map((weekday) => (
          <div key={weekday} className="px-2 py-2 text-center text-xs text-muted-foreground">
            {weekday}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((day, index) => {
          const dayItems = byDay.get(day.key) ?? [];
          const hidden = dayItems.length - MAX_PER_DAY;
          return (
            <div
              key={day.key}
              className={cn(
                "min-h-20 border-border p-1.5 sm:min-h-28",
                index % 7 !== 0 && "border-l",
                index >= 7 && "border-t",
                !day.inMonth && "bg-background/40",
              )}
            >
              <Link
                href={day.href}
                aria-label={`${day.weekday}, ${day.label}: ${dayItems.length} agendamento(s)`}
                className={cn(
                  "mb-1 inline-flex size-7 items-center justify-center rounded-full text-xs tabular-nums hover:bg-muted",
                  day.isToday ? "bg-rose/15 font-medium text-rose" : day.inMonth ? "text-foreground" : "text-muted-foreground/60",
                )}
              >
                {day.dayNumber}
              </Link>
              {dayItems.length > 0 ? (
                <span className="ml-1 text-[0.6875rem] text-muted-foreground tabular-nums sm:hidden">{dayItems.length}</span>
              ) : null}
              <ul className="hidden space-y-1 sm:block">
                {dayItems.slice(0, MAX_PER_DAY).map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => onOpen(item)}
                      className="flex w-full items-center gap-1.5 rounded-md px-1 py-0.5 text-left text-[0.6875rem] hover:bg-muted"
                    >
                      <span aria-hidden className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: item.color ?? DEFAULT_COLOR }} />
                      <span className="text-muted-foreground tabular-nums">{item.timeLabel.slice(0, 5)}</span>
                      <span
                        className={cn(
                          "truncate",
                          item.status === "CANCELLED" && "text-muted-foreground line-through",
                          item.status === "NO_SHOW" ? "text-brick" : "text-foreground",
                        )}
                      >
                        {item.subject.name}
                      </span>
                    </button>
                  </li>
                ))}
                {hidden > 0 ? (
                  <li>
                    <Link href={day.href} className="px-1 text-[0.6875rem] text-rose hover:underline">
                      +{hidden} {hidden === 1 ? "agendamento" : "agendamentos"}
                    </Link>
                  </li>
                ) : null}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}
