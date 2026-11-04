"use client";

import { usePathname } from "next/navigation";
import { Suspense } from "react";

import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { ADMIN_MODULES, MAIN_MODULES } from "@/lib/app-modules";

const SECTIONS = [...MAIN_MODULES, ...ADMIN_MODULES];

function sectionFor(pathname: string): string | undefined {
  return SECTIONS.find((module) => pathname === module.href || pathname.startsWith(`${module.href}/`))
    ?.label;
}

/**
 * Nome da seção atual. Fica em <Suspense>: em rotas com parâmetro dinâmico
 * (ex.: /pacientes/[id]) o caminho só é conhecido na requisição.
 */
function SectionLabel() {
  const section = sectionFor(usePathname());
  return section ? <span className="truncate text-sm text-muted-foreground">{section}</span> : null;
}

/**
 * Cabeçalho fixo: alterna a barra lateral e indica a seção atual. Fora de
 * produção, deixa explícito que o ambiente usa dados fictícios.
 */
export function AppHeader({ isDevelopment }: { isDevelopment: boolean }) {
  return (
    <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-3 border-b border-border bg-background/85 px-4 backdrop-blur-md supports-[backdrop-filter]:bg-background/70 sm:px-6">
      <SidebarTrigger className="-ml-1.5 text-muted-foreground hover:text-foreground" />
      <Separator orientation="vertical" className="h-5! self-center" />
      <Suspense fallback={null}>
        <SectionLabel />
      </Suspense>
      {isDevelopment ? (
        <span
          className="ml-auto inline-flex shrink-0 items-center gap-2 rounded-full border border-champagne/25 bg-champagne/[0.08] px-3 py-1 text-xs text-champagne"
          title="Este ambiente usa apenas dados fictícios criados pelo seed."
        >
          <span aria-hidden className="size-1.5 rounded-full bg-champagne" />
          <span className="hidden sm:inline">Desenvolvimento: dados fictícios</span>
          <span className="sm:hidden">Dados fictícios</span>
        </span>
      ) : null}
    </header>
  );
}
