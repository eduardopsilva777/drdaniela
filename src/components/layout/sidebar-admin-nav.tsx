import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
} from "@/components/ui/sidebar";
import { ADMIN_MODULES } from "@/lib/app-modules";
import { hasPermission } from "@/lib/auth/permissions";
import { getCurrentUser } from "@/server/auth/dal";

import { NavLink } from "./nav-link";

/** Seção "Gestão": renderizada no servidor apenas para quem tem permissão. */
export async function SidebarAdminNav() {
  const user = await getCurrentUser();
  if (!user) return null;

  const modules = ADMIN_MODULES.filter((module) => hasPermission(user.role, module.permission));
  if (modules.length === 0) return null;

  return (
    <SidebarGroup className="px-3 py-1">
      <SidebarGroupLabel className="px-2.5 text-overline text-muted-foreground uppercase">
        Gestão
      </SidebarGroupLabel>
      <SidebarGroupContent>
        <nav aria-label="Gestão">
          <SidebarMenu className="gap-0.5">
            {modules.map((module) => (
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
  );
}
