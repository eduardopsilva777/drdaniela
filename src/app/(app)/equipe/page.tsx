import type { Metadata } from "next";
import { Suspense } from "react";

import { TableSkeleton } from "@/components/data/table-skeleton";
import { AccessDenied } from "@/components/layout/access-denied";
import { PageContainer, PageHeader, Panel } from "@/components/layout/page";
import { NewStaffButton, StaffActions } from "@/components/team/staff-dialogs";
import { StatusBadge } from "@/components/ui-kit/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ROLE_LABELS } from "@/lib/auth/permissions";
import { formatDateTime } from "@/lib/format";
import { checkPermission } from "@/server/auth/dal";
import { getServerEnv } from "@/server/env";
import { listStaff } from "@/server/queries/users";

export const metadata: Metadata = { title: "Equipe" };

export default function TeamPage() {
  return (
    <PageContainer>
      <PageHeader
        title="Equipe"
        description="Contas de acesso e perfis de permissão. Contas não são excluídas — são desativadas, para preservar o histórico e a auditoria."
        actions={
          <Suspense fallback={null}>
            <NewStaffAction />
          </Suspense>
        }
      />
      <Suspense fallback={<TableSkeleton rows={5} />}>
        <StaffTable />
      </Suspense>
    </PageContainer>
  );
}

async function NewStaffAction() {
  const { allowed } = await checkPermission("users:manage");
  return allowed ? <NewStaffButton /> : null;
}

async function StaffTable() {
  const { user, allowed } = await checkPermission("users:manage");
  if (!allowed) return <AccessDenied resource="a gestão da equipe" />;

  const staff = await listStaff();
  const timeZone = getServerEnv().APP_TIMEZONE;

  return (
    <Panel aria-label="Contas da equipe" className="overflow-hidden">
      <div className="overflow-x-auto">
        <Table className="min-w-[48rem]">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="pl-6 text-muted-foreground">Pessoa</TableHead>
              <TableHead className="text-muted-foreground">Perfil</TableHead>
              <TableHead className="text-muted-foreground">Situação</TableHead>
              <TableHead className="text-muted-foreground">Último acesso</TableHead>
              <TableHead className="pr-6 text-right text-muted-foreground">
                <span className="sr-only">Ações</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {staff.map((member) => (
              <TableRow key={member.id} className={member.isActive ? undefined : "opacity-60"}>
                <TableCell className="pl-6">
                  <p className="font-medium text-foreground">
                    {member.name}
                    {member.id === user.id ? <span className="ml-2 text-xs font-normal text-muted-foreground">(você)</span> : null}
                  </p>
                  <p className="text-xs text-muted-foreground">{member.email}</p>
                </TableCell>
                <TableCell>
                  <StatusBadge tone={member.role === "ADMIN" ? "rose" : member.role === "PROFESSIONAL" ? "lavender" : "neutral"} label={ROLE_LABELS[member.role]} />
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1.5">
                    <StatusBadge tone={member.isActive ? "sage" : "muted"} label={member.isActive ? "Ativa" : "Desativada"} />
                    {member.isActive && member.mustChangePassword ? <StatusBadge tone="champagne" label="Senha provisória" /> : null}
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground tabular-nums">
                  {member.lastLoginAt ? formatDateTime(member.lastLoginAt, timeZone) : "Nunca acessou"}
                </TableCell>
                <TableCell className="pr-6 text-right">
                  <StaffActions
                    staff={{ id: member.id, name: member.name, email: member.email, role: member.role, isActive: member.isActive }}
                    isSelf={member.id === user.id}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </Panel>
  );
}
