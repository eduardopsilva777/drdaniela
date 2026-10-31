import { Skeleton } from "@/components/ui/skeleton";
import { ROLE_LABELS } from "@/lib/auth/permissions";
import { initials } from "@/lib/format";
import { requireUser } from "@/server/auth/dal";

import { UserMenu } from "./user-menu";

/**
 * Usuário da sessão no rodapé da barra lateral. Como todo layout autenticado
 * passa por aqui, uma sessão inválida também é redirecionada para o login.
 * Só dados de exibição seguem para o componente cliente.
 */
export async function SidebarUser() {
  const user = await requireUser();
  return (
    <UserMenu
      name={user.name}
      email={user.email}
      roleLabel={ROLE_LABELS[user.role]}
      initials={initials(user.name)}
    />
  );
}

export function SidebarUserSkeleton() {
  return (
    <div className="flex items-center gap-3 px-2 py-2" aria-hidden>
      <Skeleton className="size-8 rounded-[0.6rem]" />
      <div className="flex flex-1 flex-col gap-1.5 group-data-[collapsible=icon]:hidden">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-2.5 w-16" />
      </div>
    </div>
  );
}
