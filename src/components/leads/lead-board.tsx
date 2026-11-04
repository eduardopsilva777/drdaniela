"use client";

import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { CalendarClock, MoreHorizontal } from "lucide-react";
import Link from "next/link";
import { useOptimistic, useState } from "react";

import { StatusBadge } from "@/components/ui-kit/status-badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { LeadPriority, LeadStatus } from "@/generated/prisma/enums";
import { useResetOnHide } from "@/hooks/use-reset-on-hide";
import {
  LEAD_PRIORITY_LABELS,
  LEAD_STATUS_LABELS,
  LEAD_STATUS_ORDER,
  LEAD_STATUS_TONES,
} from "@/lib/labels";
import { cn } from "@/lib/utils";

import { useLeadMoves, type MovableLead } from "./use-lead-moves";

export interface BoardCard extends MovableLead {
  priority: LeadPriority;
  sourceLabel: string;
  interest: string | null;
  ownerInitials: string | null;
  ownerName: string | null;
  nextAction: { label: string; overdue: boolean } | null;
  lostReason: string | null;
}

export interface BoardColumnData {
  status: LeadStatus;
  total: number;
  items: BoardCard[];
}

function moveCard(columns: BoardColumnData[], leadId: string, to: LeadStatus): BoardColumnData[] {
  let moved: BoardCard | undefined;
  const without = columns.map((column) => {
    const card = column.items.find((item) => item.id === leadId);
    if (!card) return column;
    moved = card;
    return { ...column, total: column.total - 1, items: column.items.filter((item) => item.id !== leadId) };
  });
  if (!moved) return columns;
  const card = { ...moved, status: to };
  return without.map((column) =>
    column.status === to ? { ...column, total: column.total + 1, items: [card, ...column.items] } : column,
  );
}

const announcements: Announcements = {
  onDragStart: ({ active }) => `Lead ${String(active.data.current?.name ?? "")} selecionado.`,
  onDragOver: ({ over }) =>
    over ? `Sobre a etapa ${LEAD_STATUS_LABELS[over.id as LeadStatus]}.` : "Fora das etapas do funil.",
  onDragEnd: ({ over }) =>
    over ? `Lead solto na etapa ${LEAD_STATUS_LABELS[over.id as LeadStatus]}.` : "Movimento cancelado.",
  onDragCancel: () => "Movimento cancelado.",
};

export function LeadBoard({ columns, closedWindowDays }: { columns: BoardColumnData[]; closedWindowDays: number }) {
  const [optimisticColumns, applyMove] = useOptimistic(
    columns,
    (state, move: { leadId: string; to: LeadStatus }) => moveCard(state, move.leadId, move.to),
  );
  const { requestMove, dialogs, reset } = useLeadMoves({
    onOptimisticMove: (leadId, to) => applyMove({ leadId, to }),
  });
  const [activeCard, setActiveCard] = useState<BoardCard | null>(null);
  useResetOnHide(reset);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  );

  function findCard(id: string): BoardCard | undefined {
    for (const column of optimisticColumns) {
      const card = column.items.find((item) => item.id === id);
      if (card) return card;
    }
    return undefined;
  }

  function onDragStart(event: DragStartEvent) {
    setActiveCard(findCard(String(event.active.id)) ?? null);
  }

  function onDragEnd(event: DragEndEvent) {
    setActiveCard(null);
    const card = findCard(String(event.active.id));
    const to = event.over?.id as LeadStatus | undefined;
    if (!card || !to) return;
    requestMove(card, to);
  }

  return (
    <>
      <DndContext
        // id estável: os ids de acessibilidade do dnd-kit (aria-describedby) precisam
        // ser iguais no servidor e no cliente, senão a hidratação diverge.
        id="lead-board"
        sensors={sensors}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => setActiveCard(null)}
        accessibility={{
          announcements,
          screenReaderInstructions: {
            draggable:
              "Para mover um lead entre etapas, pressione espaço, use as setas e pressione espaço de novo para soltar. Esc cancela. Também é possível usar o menu Mover para.",
          },
        }}
      >
        <div className="-mx-4 overflow-x-auto px-4 pb-4 sm:-mx-6 sm:px-6 lg:-mx-9 lg:px-9">
          <div className="grid min-w-max auto-cols-[minmax(17rem,1fr)] grid-flow-col gap-4 xl:min-w-0 xl:grid-cols-5">
            {optimisticColumns.map((column) => (
              <BoardColumn
                key={column.status}
                column={column}
                closedWindowDays={closedWindowDays}
                onMove={requestMove}
              />
            ))}
          </div>
        </div>
        <DragOverlay dropAnimation={null}>
          {activeCard ? <LeadCardContent card={activeCard} dragging /> : null}
        </DragOverlay>
      </DndContext>
      {dialogs}
    </>
  );
}

function BoardColumn({
  column,
  closedWindowDays,
  onMove,
}: {
  column: BoardColumnData;
  closedWindowDays: number;
  onMove: (card: BoardCard, to: LeadStatus) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: column.status });
  const isClosed = column.status === "CONVERTED" || column.status === "LOST";

  return (
    <section
      ref={setNodeRef}
      aria-label={`${LEAD_STATUS_LABELS[column.status]}: ${column.total} leads`}
      className={cn(
        "flex min-h-[24rem] flex-col rounded-xl border border-border bg-muted/55 transition-colors",
        isOver && "border-primary/50 bg-primary/[0.04]",
      )}
    >
      <header className="flex items-center justify-between gap-2 px-4 pt-4 pb-3">
        <StatusBadge tone={LEAD_STATUS_TONES[column.status]} label={LEAD_STATUS_LABELS[column.status]} />
        <span className="text-sm text-muted-foreground tabular-nums">{column.total}</span>
      </header>
      {isClosed ? (
        <p className="px-4 pb-2 text-xs text-muted-foreground">Últimos {closedWindowDays} dias</p>
      ) : null}
      <ul className="flex flex-1 flex-col gap-2.5 px-3 pb-3">
        {column.items.map((card) => (
          <DraggableLeadCard key={card.id} card={card} onMove={onMove} />
        ))}
        {column.items.length === 0 ? (
          <li className="rounded-xl border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
            Arraste um lead para cá
          </li>
        ) : null}
        {column.total > column.items.length ? (
          <li className="px-1 pt-1 text-xs text-muted-foreground">
            Mostrando {column.items.length} de {column.total}. Use a visão de lista para ver todos.
          </li>
        ) : null}
      </ul>
    </section>
  );
}

function DraggableLeadCard({ card, onMove }: { card: BoardCard; onMove: (card: BoardCard, to: LeadStatus) => void }) {
  const disabled = card.status === "CONVERTED";
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: card.id,
    data: { name: card.name },
    disabled,
  });

  return (
    <li
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      aria-roledescription="lead arrastável"
      className={cn(
        "touch-manipulation rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring",
        isDragging && "opacity-40",
        !disabled && "cursor-grab active:cursor-grabbing",
      )}
    >
      <LeadCardContent card={card} onMove={onMove} />
    </li>
  );
}

function LeadCardContent({
  card,
  onMove,
  dragging,
}: {
  card: BoardCard;
  onMove?: (card: BoardCard, to: LeadStatus) => void;
  dragging?: boolean;
}) {
  return (
    <article
      className={cn(
        "space-y-2.5 rounded-xl border border-border bg-card p-3.5 text-sm",
        dragging && "rotate-1 border-primary/40 shadow-lg",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <Link
            href={`/leads/${card.id}`}
            className="block truncate font-medium text-foreground hover:underline hover:underline-offset-4"
            onPointerDown={(event) => event.stopPropagation()}
          >
            {card.name}
          </Link>
          <p className="truncate text-xs text-muted-foreground tabular-nums">{card.phoneLabel}</p>
        </div>
        {onMove && card.status !== "CONVERTED" ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`Mover ${card.name} para outra etapa`}
                onPointerDown={(event) => event.stopPropagation()}
                className="-mr-1 shrink-0 text-muted-foreground"
              >
                <MoreHorizontal aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-44">
              <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Mover para</DropdownMenuLabel>
              {LEAD_STATUS_ORDER.filter((status) => status !== card.status).map((status) => (
                <DropdownMenuItem key={status} onSelect={() => onMove(card, status)}>
                  {status === "CONVERTED" ? "Converter em paciente" : LEAD_STATUS_LABELS[status]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>

      {card.interest ? <p className="line-clamp-2 text-[0.8125rem] text-foreground/80">{card.interest}</p> : null}
      {card.status === "LOST" && card.lostReason ? (
        <p className="line-clamp-2 text-xs text-destructive/90">{card.lostReason}</p>
      ) : null}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
        <span>{card.sourceLabel}</span>
        {card.priority === "HIGH" ? (
          <span className="inline-flex items-center gap-1 text-primary">
            <span aria-hidden className="size-1.5 rounded-full bg-primary" />
            Prioridade {LEAD_PRIORITY_LABELS.HIGH.toLowerCase()}
          </span>
        ) : null}
      </div>

      {card.nextAction || card.ownerInitials ? (
        <div className="flex items-center justify-between gap-2 border-t border-border pt-2.5 text-xs">
          {card.nextAction ? (
            <span className={cn("inline-flex items-center gap-1.5", card.nextAction.overdue ? "text-destructive" : "text-muted-foreground")}>
              <CalendarClock aria-hidden className="size-3.5" />
              {card.nextAction.label}
            </span>
          ) : (
            <span />
          )}
          {card.ownerInitials ? (
            <span
              title={card.ownerName ?? undefined}
              aria-label={`Responsável: ${card.ownerName}`}
              className="flex size-6 items-center justify-center rounded-full bg-primary-subtle text-[0.625rem] font-bold text-primary-subtle-foreground"
            >
              {card.ownerInitials}
            </span>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
