import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * A escala tipográfica da Clinni (`text-display`, `text-title-1`… em
 * `globals.css`) precisa ser declarada aqui: sem isso o tailwind-merge trata
 * `text-metric` como cor e o descarta ao lado de `text-destructive`.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ["display", "title-1", "title-2", "title-3", "metric", "overline"],
    },
  },
});

/**
 * Combina classes condicionais e resolve conflitos de utilitários Tailwind
 * (ex.: `px-2` + `px-4` → `px-4`). Usado por todos os componentes de UI.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
