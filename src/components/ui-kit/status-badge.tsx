import type { Tone } from "@/lib/labels";
import { cn } from "@/lib/utils";

const TONE_CLASSES: Record<Tone, { badge: string; dot: string }> = {
  neutral: { badge: "bg-foreground/[0.07] text-foreground/90", dot: "bg-foreground/60" },
  rose: { badge: "bg-rose/12 text-rose", dot: "bg-rose" },
  champagne: { badge: "bg-champagne/12 text-champagne", dot: "bg-champagne" },
  lavender: { badge: "bg-lavender/12 text-lavender", dot: "bg-lavender" },
  sage: { badge: "bg-sage/12 text-sage", dot: "bg-sage" },
  brick: { badge: "bg-brick/12 text-brick", dot: "bg-brick" },
  muted: { badge: "bg-muted text-muted-foreground", dot: "bg-muted-foreground/60" },
};

/** Etiqueta de status com cor semântica (sempre acompanhada de texto, nunca só cor). */
export function StatusBadge({
  tone,
  label,
  className,
}: {
  tone: Tone;
  label: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs leading-5 whitespace-nowrap",
        TONE_CLASSES[tone].badge,
        className,
      )}
    >
      <span aria-hidden className={cn("size-1.5 rounded-full", TONE_CLASSES[tone].dot)} />
      {label}
    </span>
  );
}
