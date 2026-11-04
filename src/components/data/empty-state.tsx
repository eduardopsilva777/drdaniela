import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Estado vazio: diz o que está faltando e qual é o próximo passo. O desenho
 * segue a linguagem visual da Clinni — o arco enquadra, o ponto marca o próximo
 * passo — em tons discretos (o damasco fica reservado ao assistente).
 */
export function EmptyState({
  title,
  description,
  action,
  className,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-start gap-3.5 px-6 py-10 sm:px-8", className)}>
      <svg viewBox="0 0 48 48" aria-hidden className="size-10 shrink-0">
        <path
          d="M24 4a20 20 0 1 0 20 20"
          fill="none"
          className="stroke-border"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray="0.5 5"
        />
        <circle cx="44" cy="24" r="3.5" className="fill-primary" />
      </svg>
      <div className="space-y-1">
        <p className="text-[0.9375rem] font-semibold text-foreground">{title}</p>
        {description ? (
          <p className="max-w-[56ch] text-sm leading-relaxed text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}
