import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/** Área de conteúdo das páginas autenticadas (alinhada à esquerda; até 1.152 px em 12 colunas). */
export function PageContainer({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("mx-auto w-full max-w-6xl px-4 py-7 sm:px-6 lg:px-9 lg:py-8", className)}>
      {children}
    </div>
  );
}

/** Título da página (Título 1 da escala: Manrope 600, 28/36, −2%) e ações principais. */
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
    // Título e ações na mesma linha quando cabem; senão as ações descem para a linha
    // de baixo e quebram entre si (fichas com várias ações em telas médias).
    <header className="flex flex-col gap-4 pb-6 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between lg:pb-7">
      <div className="min-w-0 space-y-1.5">
        <h1 className="text-2xl leading-8 font-semibold tracking-[-0.02em] text-foreground sm:text-title-1">{title}</h1>
        {description ? (
          <div className="max-w-[65ch] text-sm leading-relaxed text-muted-foreground">{description}</div>
        ) : null}
      </div>
      {actions ? <div className="flex max-w-full flex-wrap items-center gap-2.5">{actions}</div> : null}
    </header>
  );
}

/** Painel de conteúdo (cartão): borda e tom, sem sombra; raio de 14 px. */
export function Panel({
  children,
  className,
  ...props
}: React.ComponentProps<"section">) {
  return (
    <section className={cn("rounded-xl border border-border bg-card text-card-foreground", className)} {...props}>
      {children}
    </section>
  );
}
