import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/** Estado vazio: diz o que está faltando e qual é o próximo passo. */
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
    <div className={cn("flex flex-col items-start gap-3 px-6 py-10 sm:px-8", className)}>
      <div className="space-y-1">
        <p className="text-[0.9375rem] font-medium text-foreground">{title}</p>
        {description ? (
          <p className="max-w-[56ch] text-sm leading-relaxed text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}
