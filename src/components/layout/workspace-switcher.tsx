"use client";

import { Check, ChevronsUpDown, Settings2 } from "lucide-react";
import Link from "next/link";

import { ClinicMark } from "@/components/brand/clinni-logo";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar";

export interface WorkspaceOption {
  id: string;
  name: string;
}

/**
 * Clínica ativa (espaço de trabalho) no topo da barra lateral. Lista as clínicas
 * a que a conta tem acesso — hoje, uma por instalação; com o modelo
 * multi-clínica a mesma peça passa a alternar entre elas. Nada é simulado:
 * só aparecem clínicas reais da conta.
 */
export function WorkspaceSwitcher({
  active,
  workspaces,
  canConfigure,
  configured,
}: {
  active: WorkspaceOption;
  workspaces: WorkspaceOption[];
  canConfigure: boolean;
  configured: boolean;
}) {
  const { isMobile, setOpenMobile } = useSidebar();
  const caption = configured || !canConfigure ? "Espaço de trabalho" : "Configuração pendente";

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="h-11 gap-2.5 rounded-lg border border-sidebar-border bg-card px-2 shadow-none hover:bg-card hover:text-sidebar-accent-foreground data-open:bg-card group-data-[collapsible=icon]:border-0 group-data-[collapsible=icon]:bg-transparent"
              aria-label={`Clínica ativa: ${active.name}. Trocar ou configurar`}
            >
              <ClinicMark name={active.name} />
              <span className="grid min-w-0 flex-1 text-left leading-tight">
                <span className="truncate text-[0.8125rem] font-semibold text-sidebar-accent-foreground">{active.name}</span>
                <span className={configured || !canConfigure ? "truncate text-[0.6875rem] text-muted-foreground" : "truncate text-[0.6875rem] text-warning"}>
                  {caption}
                </span>
              </span>
              <ChevronsUpDown aria-hidden className="ml-auto size-4 text-muted-foreground" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="min-w-64"
            side={isMobile ? "bottom" : "right"}
            align="start"
            sideOffset={8}
          >
            <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">
              {workspaces.length > 1 ? "Suas clínicas" : "Sua clínica"}
            </DropdownMenuLabel>
            {workspaces.map((workspace) => (
              <DropdownMenuItem key={workspace.id} className="gap-2.5" aria-current={workspace.id === active.id ? "true" : undefined}>
                <ClinicMark name={workspace.name} className="size-6 text-[0.625rem]" />
                <span className="min-w-0 flex-1 truncate">{workspace.name}</span>
                {workspace.id === active.id ? <Check aria-hidden className="text-primary" /> : null}
              </DropdownMenuItem>
            ))}
            {canConfigure ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/assistente?aba=configuracoes" onClick={() => isMobile && setOpenMobile(false)}>
                    <Settings2 aria-hidden />
                    {configured ? "Dados da clínica" : "Configurar a clínica"}
                  </Link>
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
