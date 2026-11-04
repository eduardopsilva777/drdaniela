import { Skeleton } from "@/components/ui/skeleton";
import { getClinicWorkspaces } from "@/server/queries/clinic";

import { WorkspaceSwitcher } from "./workspace-switcher";

/** Clínica ativa, lida na requisição (chega por streaming, dentro de <Suspense>). */
export async function SidebarWorkspace() {
  const { active, all, canConfigure } = await getClinicWorkspaces();
  return (
    <WorkspaceSwitcher
      active={{ id: active.id, name: active.name }}
      workspaces={all.map((item) => ({ id: item.id, name: item.name }))}
      canConfigure={canConfigure}
      configured={active.configured}
    />
  );
}

export function SidebarWorkspaceSkeleton() {
  return (
    <div className="flex h-11 items-center gap-2.5 rounded-lg border border-sidebar-border bg-card px-2 group-data-[collapsible=icon]:border-0 group-data-[collapsible=icon]:bg-transparent" aria-hidden>
      <Skeleton className="size-7 rounded-md" />
      <div className="flex flex-1 flex-col gap-1.5 group-data-[collapsible=icon]:hidden">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-2.5 w-20" />
      </div>
    </div>
  );
}
