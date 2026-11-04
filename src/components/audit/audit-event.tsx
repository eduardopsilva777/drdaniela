import { describeAuditAction, type AuditTone } from "@/lib/audit-labels";
import { cn } from "@/lib/utils";

const TONE_CLASSES: Record<AuditTone, string> = {
  positive: "bg-success",
  neutral: "bg-muted-foreground/60",
  warning: "bg-warning",
  critical: "bg-destructive",
};

/** Nome do evento com um marcador de cor que indica a gravidade. */
export function AuditEvent({
  action,
  detail,
  className,
}: {
  action: string;
  detail?: string | null;
  className?: string;
}) {
  const { label, tone } = describeAuditAction(action);
  return (
    <span className={cn("flex min-w-0 items-start gap-2.5", className)}>
      <span aria-hidden className={cn("mt-[0.45rem] size-1.5 shrink-0 rounded-full", TONE_CLASSES[tone])} />
      <span className="min-w-0">
        <span className="text-foreground">{label}</span>
        {detail ? <span className="block text-xs text-muted-foreground">{detail}</span> : null}
      </span>
    </span>
  );
}
