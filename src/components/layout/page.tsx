import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/** Área de conteúdo das páginas autenticadas (alinhada à esquerda, largura controlada). */
export function PageContainer({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-10 lg:py-12", className)}>
      {children}
    </div>
  );
}

/** Título da página em Bodoni — o único lugar da interface em que a serifa aparece. */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-5 pb-8 sm:flex-row sm:items-end sm:justify-between lg:pb-10">
      <div className="min-w-0 space-y-2.5">
        <h1 className="font-display text-[2.125rem] leading-[1.08] text-foreground sm:text-[2.625rem]">
          {title}
        </h1>
        {description ? (
          <div className="max-w-[62ch] text-[0.9375rem] leading-relaxed text-muted-foreground">
            {description}
          </div>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
}

/** Painel de conteúdo. O raio maior marca o nível de contêiner. */
export function Panel({
  children,
  className,
  ...props
}: React.ComponentProps<"section">) {
  return (
    <section
      className={cn(
        "rounded-2xl border border-border bg-card shadow-[inset_0_1px_0_0_oklch(1_0_0/0.035)]",
        className,
      )}
      {...props}
    >
      {children}
    </section>
  );
}
