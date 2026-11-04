"use client";

import {
  Bot,
  CalendarDays,
  CalendarSync,
  LayoutGrid,
  ListTodo,
  MessageCircle,
  ShieldCheck,
  Sparkles,
  UserRoundCog,
  UserRoundPlus,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Suspense } from "react";

import {
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import type { ModuleAvailability, ModuleIcon } from "@/lib/app-modules";

const ICONS: Record<ModuleIcon, LucideIcon> = {
  dashboard: LayoutGrid,
  leads: UserRoundPlus,
  patients: UsersRound,
  agenda: CalendarDays,
  procedures: Sparkles,
  protocols: CalendarSync,
  whatsapp: MessageCircle,
  assistant: Bot,
  tasks: ListTodo,
  team: UserRoundCog,
  audit: ShieldCheck,
};

export interface NavLinkProps {
  href: string;
  label: string;
  icon: ModuleIcon;
  availability: ModuleAvailability;
}

/**
 * Item da navegação. O destaque do item ativo depende da URL: em rotas com
 * parâmetro dinâmico ela só é conhecida na requisição, então o item é
 * pré-renderizado sem destaque e o estado ativo chega por streaming.
 */
export function NavLink(props: NavLinkProps) {
  return (
    <Suspense fallback={<NavLinkItem {...props} isActive={false} />}>
      <ActiveNavLink {...props} />
    </Suspense>
  );
}

function ActiveNavLink(props: NavLinkProps) {
  const pathname = usePathname();
  const isActive = pathname === props.href || pathname.startsWith(`${props.href}/`);
  return <NavLinkItem {...props} isActive={isActive} />;
}

function NavLinkItem({ href, label, icon, availability, isActive }: NavLinkProps & { isActive: boolean }) {
  const { isMobile, setOpenMobile } = useSidebar();
  const Icon = ICONS[icon];
  const planned = availability.status === "planned";

  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        asChild
        isActive={isActive}
        tooltip={label}
        className="h-9 gap-3 rounded-lg px-2.5 text-sm text-sidebar-foreground transition-colors data-[planned=true]:pr-16 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground data-active:bg-nav-active data-active:font-semibold data-active:text-nav-active-foreground [&>svg]:size-[1.125rem] [&>svg]:text-sidebar-foreground/80 data-active:[&>svg]:text-primary"
      >
        <Link
          href={href}
          data-planned={planned}
          aria-current={isActive ? "page" : undefined}
          onClick={() => {
            if (isMobile) setOpenMobile(false);
          }}
        >
          <Icon aria-hidden />
          <span>{label}</span>
        </Link>
      </SidebarMenuButton>
      {planned ? (
        <SidebarMenuBadge
          className="top-2! right-2 h-5 rounded-full px-1.5 text-[0.6875rem] font-medium text-muted-foreground"
          aria-label={`Previsto para a etapa ${availability.stage}`}
        >
          etapa {availability.stage}
        </SidebarMenuBadge>
      ) : null}
    </SidebarMenuItem>
  );
}
