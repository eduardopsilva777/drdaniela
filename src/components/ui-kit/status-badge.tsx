import type { Tone } from "@/lib/labels";
import { cn } from "@/lib/utils";

/**
 * Tons semânticos (identidade Clinni, "Estados"): fundo suave, texto forte e um
 * ponto. O damasco nunca indica status — fica reservado ao assistente.
 */
const TONE_CLASSES: Record<Tone, { badge: string; dot: string }> = {
  neutral: { badge: "bg-muted text-foreground", dot: "bg-foreground/55" },
  primary: { badge: "bg-primary-subtle text-primary-subtle-foreground", dot: "bg-primary" },
  warning: { badge: "bg-warning-subtle text-warning", dot: "bg-warning" },
  info: { badge: "bg-info-subtle text-info", dot: "bg-info" },
  success: { badge: "bg-success-subtle text-success", dot: "bg-success" },
  danger: { badge: "bg-destructive-subtle text-destructive", dot: "bg-destructive" },
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
        "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs leading-5 font-semibold whitespace-nowrap",
        TONE_CLASSES[tone].badge,
        className,
      )}
    >
      <span aria-hidden className={cn("size-1.5 rounded-full", TONE_CLASSES[tone].dot)} />
      {label}
    </span>
  );
}
