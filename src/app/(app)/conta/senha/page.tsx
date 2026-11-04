import { KeyRound } from "lucide-react";
import type { Metadata } from "next";
import { Suspense } from "react";

import { PageContainer, PageHeader, Panel } from "@/components/layout/page";
import { PasswordChangeForm } from "@/components/team/staff-dialogs";
import { Skeleton } from "@/components/ui/skeleton";
import { requireUser } from "@/server/auth/dal";

export const metadata: Metadata = { title: "Alterar senha" };

export default function PasswordPage() {
  return (
    <PageContainer className="max-w-2xl">
      <PageHeader title="Sua senha" description="A troca encerra as outras sessões abertas com a sua conta." />
      <Suspense fallback={<Skeleton className="h-80 rounded-2xl" />}>
        <PasswordPanel />
      </Suspense>
    </PageContainer>
  );
}

async function PasswordPanel() {
  const user = await requireUser({ allowPendingPasswordChange: true });
  return (
    <Panel className="p-6 sm:p-8">
      {user.mustChangePassword ? (
        <div role="alert" className="mb-6 flex items-start gap-3 rounded-xl border border-champagne/30 bg-champagne/[0.06] p-4 text-sm">
          <KeyRound aria-hidden className="mt-0.5 size-4 shrink-0 text-champagne" />
          <p className="text-foreground">
            Você entrou com uma senha provisória definida pela administração. Defina uma senha pessoal para continuar usando
            o sistema.
          </p>
        </div>
      ) : null}
      <PasswordChangeForm forced={user.mustChangePassword} />
    </Panel>
  );
}
