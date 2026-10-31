import { cn } from "@/lib/utils";

/**
 * Monograma "DZ" desenhado em traço, com o contraste de hastes de uma
 * didone (verticais e diagonais grossas, horizontais finas). Feito em SVG
 * para não depender de fontes instaladas e manter a nitidez em qualquer tamanho.
 */
export function Monogram({ className, title }: { className?: string; title?: string }) {
  return (
    <svg
      viewBox="10 16 44 32"
      className={cn("h-6 w-auto text-rose", className)}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      fill="none"
      stroke="currentColor"
    >
      <path d="M15.5 19v26" strokeWidth="5" />
      <path d="M13 19.25h8a12.75 12.75 0 0 1 0 25.5h-8" strokeWidth="2.5" />
      <path d="M37 19.25h13" strokeWidth="2.5" />
      <path d="M48.6 20.4 38.4 43.6" strokeWidth="5" />
      <path d="M37 44.75h13" strokeWidth="2.5" />
    </svg>
  );
}
