"use client";

import { ChevronsUpDown, KeyRound, LogOut } from "lucide-react";
import Link from "next/link";
import { useRef } from "react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar";
import { logoutAction } from "@/server/auth/actions";

export interface UserMenuProps {
  name: string;
  email: string;
  roleLabel: string;
  initials: string;
}

export function UserMenu({ name, email, roleLabel, initials }: UserMenuProps) {
  const { isMobile } = useSidebar();
  // O formulário fica fora do menu: o conteúdo do dropdown é desmontado ao fechar.
  const logoutForm = useRef<HTMLFormElement>(null);

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <form ref={logoutForm} action={logoutAction} className="hidden" />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="gap-3 rounded-lg px-2 data-open:bg-sidebar-accent"
              aria-label={`Conta de ${name}`}
            >
              <Avatar className="size-8 rounded-[0.6rem]">
                <AvatarFallback className="rounded-[0.6rem] bg-rose/12 text-xs font-medium text-rose">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <span className="grid min-w-0 flex-1 text-left leading-tight">
                <span className="truncate text-sm font-medium text-sidebar-accent-foreground">
                  {name}
                </span>
                <span className="truncate text-xs text-sidebar-foreground/55">{roleLabel}</span>
              </span>
              <ChevronsUpDown aria-hidden className="ml-auto size-4 text-sidebar-foreground/45" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="min-w-60 rounded-xl"
            side={isMobile ? "top" : "right"}
            align="end"
            sideOffset={8}
          >
            <DropdownMenuLabel className="font-normal">
              <span className="block truncate text-sm font-medium text-foreground">{name}</span>
              <span className="block truncate text-xs text-muted-foreground">{email}</span>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/conta/senha">
                <KeyRound aria-hidden />
                Alterar senha
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => logoutForm.current?.requestSubmit()}>
              <LogOut aria-hidden />
              Sair
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
