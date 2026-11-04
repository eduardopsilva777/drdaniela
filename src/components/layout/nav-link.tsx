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
        className="relative h-9 gap-3 rounded-lg px-3 text-[0.9rem] text-sidebar-foreground/80 transition-colors data-[planned=true]:pr-16 before:absolute before:top-1/2 before:left-0 before:h-4 before:w-0.5 before:-translate-y-1/2 before:rounded-full before:bg-rose before:opacity-0 before:transition-opacity data-active:text-sidebar-accent-foreground data-active:before:opacity-100 [&>svg]:text-sidebar-foreground/55 data-active:[&>svg]:text-rose"
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
          className="top-2! right-2 h-5 rounded-full px-1.5 text-[0.6875rem] font-normal text-sidebar-foreground/45"
          aria-label={`Previsto para a etapa ${availability.stage}`}
        >
          etapa {availability.stage}
        </SidebarMenuBadge>
      ) : null}
    </SidebarMenuItem>
  );
}
