"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { Monogram } from "@/components/brand/monogram";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarRail,
} from "@/components/ui/sidebar";
import { MAIN_MODULES } from "@/lib/app-modules";

import { NavLink } from "./nav-link";

/**
 * Barra lateral. A navegação principal é igual para todos os perfis e entra no
 * HTML estático; a seção administrativa e o usuário dependem da sessão e chegam
 * por streaming (slots renderizados no servidor, dentro de <Suspense>).
 */
export function AppSidebar({ adminNav, userMenu }: { adminNav: ReactNode; userMenu: ReactNode }) {
  return (
    <Sidebar collapsible="icon" className="border-sidebar-border">
      <SidebarHeader className="px-3 pt-5 pb-4">
        <Link
          href="/dashboard"
          className="flex items-center gap-3 rounded-lg px-1 py-1 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-[0.7rem] border border-rose/20 bg-rose/[0.06]">
            <Monogram className="h-[1.05rem]" />
          </span>
          <span className="flex min-w-0 flex-col group-data-[collapsible=icon]:hidden">
            <span className="truncate font-display text-[1.05rem] leading-tight text-sidebar-accent-foreground">
              Daniela Zilioli
            </span>
            <span className="truncate text-xs text-sidebar-foreground/55">Gestão da clínica</span>
          </span>
        </Link>
      </SidebarHeader>

      <SidebarContent className="gap-1">
        <SidebarGroup className="px-3 py-1">
          <SidebarGroupContent>
            <nav aria-label="Navegação principal">
              <SidebarMenu className="gap-0.5">
                {MAIN_MODULES.map((module) => (
                  <NavLink
                    key={module.key}
                    href={module.href}
                    label={module.label}
                    icon={module.icon}
                    availability={module.availability}
                  />
                ))}
              </SidebarMenu>
            </nav>
          </SidebarGroupContent>
        </SidebarGroup>
        {adminNav}
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border px-3 py-3">{userMenu}</SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
