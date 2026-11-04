import { Suspense, type ReactNode } from "react";

import { AppHeader } from "@/components/layout/app-header";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { SidebarAdminNav } from "@/components/layout/sidebar-admin-nav";
import { SidebarUser, SidebarUserSkeleton } from "@/components/layout/sidebar-user";
import { SidebarWorkspace, SidebarWorkspaceSkeleton } from "@/components/layout/sidebar-workspace";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";

/**
 * Estrutura das áreas autenticadas. O layout em si não lê a sessão (isso
 * bloquearia todo o segmento): as partes que dependem do usuário são
 * renderizadas dentro de <Suspense> e cada página valida a sessão na DAL.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <SidebarProvider style={{ "--sidebar-width": "17rem" } as React.CSSProperties}>
      <a
        href="#conteudo"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:text-primary-foreground"
      >
        Pular para o conteúdo
      </a>
      <AppSidebar
        workspace={
          <Suspense fallback={<SidebarWorkspaceSkeleton />}>
            <SidebarWorkspace />
          </Suspense>
        }
        adminNav={
          <Suspense fallback={null}>
            <SidebarAdminNav />
          </Suspense>
        }
        userMenu={
          <Suspense fallback={<SidebarUserSkeleton />}>
            <SidebarUser />
          </Suspense>
        }
      />
      <SidebarInset className="min-w-0 bg-background">
        <AppHeader isDevelopment={process.env.NODE_ENV !== "production"} />
        <div id="conteudo" tabIndex={-1} className="flex-1 outline-none">
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
