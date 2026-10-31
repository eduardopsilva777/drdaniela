import type { AppModule } from "@/lib/app-modules";

import { PageContainer, PageHeader, Panel } from "./page";

/**
 * Página de um módulo ainda não entregue. Diz com clareza que nada aqui
 * funciona ainda e o que o módulo vai fazer — sem telas simuladas.
 */
export function ModulePending({ module }: { module: AppModule }) {
  const stage = module.availability.status === "planned" ? module.availability.stage : null;

  return (
    <PageContainer>
      <PageHeader title={module.label} description={module.summary} />

      <Panel aria-labelledby="module-status-title" className="max-w-3xl p-6 sm:p-8">
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-2 rounded-full border border-champagne/25 bg-champagne/[0.08] px-3 py-1 text-xs text-champagne">
            <span aria-hidden className="size-1.5 rounded-full bg-champagne" />
            {stage ? `Previsto para a etapa ${stage}` : "Em implantação"}
          </span>
        </div>

        <h2 id="module-status-title" className="mt-5 text-lg font-medium text-foreground">
          Este módulo ainda não está disponível
        </h2>
        <p className="mt-1.5 max-w-[60ch] text-sm leading-relaxed text-muted-foreground">
          Nenhuma funcionalidade desta área está ativa ainda. Quando for entregue, ela vai permitir:
        </p>

        <ul className="mt-5 space-y-3">
          {module.scope.map((item) => (
            <li key={item} className="flex gap-3 text-[0.9375rem] leading-snug text-foreground/90">
              <span aria-hidden className="mt-[0.55rem] size-1.5 shrink-0 rounded-full bg-rose/70" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </Panel>
    </PageContainer>
  );
}
