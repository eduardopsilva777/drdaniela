"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { ClinniLogo, ClinniSymbol } from "@/components/brand/clinni-logo";
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
 * Barra lateral. A marca é a do produto (Clinni); a clínica aparece como espaço
 * de trabalho logo abaixo. A navegação principal é igual para todos os perfis
 * e entra no HTML estático; clínica, seção administrativa e usuário dependem
 * da sessão e chegam por streaming (slots renderizados no servidor).
 */
export function AppSidebar({ workspace, adminNav, userMenu }: { workspace: ReactNode; adminNav: ReactNode; userMenu: ReactNode }) {
  return (
    <Sidebar collapsible="icon" className="border-sidebar-border">
      <SidebarHeader className="gap-3.5 px-3 pt-5 pb-3">
        <Link
          href="/dashboard"
          aria-label="Clinni — ir para o dashboard"
          className="flex h-8 items-center px-2 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0"
        >
          <ClinniLogo className="h-[1.625rem] group-data-[collapsible=icon]:hidden" title="Clinni" />
          <ClinniSymbol className="hidden size-6 group-data-[collapsible=icon]:block" title="Clinni" />
        </Link>
        {workspace}
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
