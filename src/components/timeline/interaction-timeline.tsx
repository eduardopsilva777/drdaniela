import {
  ArrowRight,
  Bot,
  Mail,
  MessageCircle,
  NotebookPen,
  Phone,
  Repeat2,
  UsersRound,
  type LucideIcon,
} from "lucide-react";

import type { InteractionDirection, InteractionType, LeadStatus } from "@/generated/prisma/enums";
import { formatDateTime } from "@/lib/format";
import { INTERACTION_TYPE_LABELS, LEAD_STATUS_LABELS } from "@/lib/labels";
import { cn } from "@/lib/utils";

const ICONS: Record<InteractionType, LucideIcon> = {
  NOTE: NotebookPen,
  CALL: Phone,
  WHATSAPP: MessageCircle,
  EMAIL: Mail,
  IN_PERSON: UsersRound,
  STATUS_CHANGE: Repeat2,
  SYSTEM: Bot,
};

export interface TimelineItem {
  id: string;
  type: InteractionType;
  direction: InteractionDirection | null;
  content: string | null;
  fromStatus: LeadStatus | null;
  toStatus: LeadStatus | null;
  occurredAt: Date;
  authorName: string | null;
}

function directionLabel(type: InteractionType, direction: InteractionDirection | null): string | null {
  if (!direction || type === "NOTE" || type === "STATUS_CHANGE" || type === "SYSTEM") return null;
  if (type === "CALL") return direction === "INBOUND" ? "recebida" : "realizada";
  if (type === "IN_PERSON") return null;
  return direction === "INBOUND" ? "recebida" : "enviada";
}

/** Linha do tempo de relacionamento (leads e pacientes), da mais recente para a mais antiga. */
export function InteractionTimeline({
  items,
  timeZone,
  emptyText = "Nenhuma interação registrada ainda.",
}: {
  items: TimelineItem[];
  timeZone: string;
  emptyText?: string;
}) {
  if (items.length === 0) {
    return <p className="py-6 text-sm text-muted-foreground">{emptyText}</p>;
  }

  return (
    <ol className="relative space-y-5 before:absolute before:top-2 before:bottom-2 before:left-[0.9375rem] before:w-px before:bg-border">
      {items.map((item) => {
        const Icon = ICONS[item.type];
        const direction = directionLabel(item.type, item.direction);
        const isStageChange = item.type === "STATUS_CHANGE" && item.toStatus;
        return (
          <li key={item.id} className="relative flex gap-4">
            <span
              className={cn(
                "relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full border border-border bg-card",
                isStageChange ? "text-rose" : "text-muted-foreground",
              )}
            >
              <Icon aria-hidden className="size-3.5" />
            </span>
            <div className="min-w-0 flex-1 pt-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <p className="text-sm font-medium text-foreground">
                  {isStageChange ? (
                    <span className="inline-flex flex-wrap items-center gap-1.5">
                      {item.fromStatus ? LEAD_STATUS_LABELS[item.fromStatus] : "Início"}
                      <ArrowRight aria-label="para" className="size-3.5 text-muted-foreground" />
                      {LEAD_STATUS_LABELS[item.toStatus!]}
                    </span>
                  ) : (
                    <>
                      {INTERACTION_TYPE_LABELS[item.type]}
                      {direction ? <span className="font-normal text-muted-foreground"> {direction}</span> : null}
                    </>
                  )}
                </p>
                <time dateTime={item.occurredAt.toISOString()} className="text-xs text-muted-foreground tabular-nums">
                  {formatDateTime(item.occurredAt, timeZone)}
                </time>
              </div>
              {item.content ? (
                <p className="mt-1 text-sm leading-relaxed whitespace-pre-line text-foreground/85">{item.content}</p>
              ) : null}
              {item.authorName ? <p className="mt-1 text-xs text-muted-foreground">por {item.authorName}</p> : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
