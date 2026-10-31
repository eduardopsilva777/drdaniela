import type { Metadata } from "next";
import { Suspense } from "react";

import { AuditEvent } from "@/components/audit/audit-event";
import { AccessDenied } from "@/components/layout/access-denied";
import { PageContainer, PageHeader, Panel } from "@/components/layout/page";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateTime } from "@/lib/format";
import { checkPermission } from "@/server/auth/dal";
import { getServerEnv } from "@/server/env";
import { getRecentAuditEntries } from "@/server/queries/audit";

export const metadata: Metadata = { title: "Auditoria" };

const PAGE_SIZE = 100;

export default function AuditPage() {
  return (
    <PageContainer>
      <PageHeader
        title="Auditoria"
        description="Entradas, saídas e tentativas de acesso ao sistema. Os registros são permanentes: o sistema não permite alterá-los nem apagá-los."
      />
      <Suspense fallback={<AuditTableFallback />}>
        <AuditLogTable />
      </Suspense>
    </PageContainer>
  );
}

async function AuditLogTable() {
  const { allowed } = await checkPermission("audit:read");
  if (!allowed) return <AccessDenied resource="a auditoria" />;

  const timeZone = getServerEnv().APP_TIMEZONE;
  const entries = await getRecentAuditEntries(PAGE_SIZE);

  if (entries.length === 0) {
    return (
      <Panel className="p-6 sm:p-8">
        <p className="text-sm text-muted-foreground">
          Nenhum registro ainda. Entradas e saídas do sistema passam a aparecer aqui
          automaticamente.
        </p>
      </Panel>
    );
  }

  return (
    <Panel aria-label="Registros de auditoria" className="overflow-hidden">
      <div className="overflow-x-auto">
        <Table className="min-w-[44rem]">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-44 pl-6 text-muted-foreground">Data e hora</TableHead>
              <TableHead className="text-muted-foreground">Evento</TableHead>
              <TableHead className="text-muted-foreground">Usuário</TableHead>
              <TableHead className="w-40 pr-6 text-muted-foreground">Endereço IP</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((entry) => (
              <TableRow key={entry.id}>
                <TableCell className="pl-6 align-top text-muted-foreground tabular-nums">
                  <time dateTime={entry.createdAt.toISOString()}>
                    {formatDateTime(entry.createdAt, timeZone)}
                  </time>
                </TableCell>
                <TableCell className="align-top whitespace-normal">
                  <AuditEvent action={entry.action} detail={entry.detail} />
                </TableCell>
                <TableCell className="align-top text-foreground/90">
                  {entry.actorName ?? <span className="text-muted-foreground">—</span>}
                </TableCell>
                <TableCell className="pr-6 align-top text-muted-foreground tabular-nums">
                  {entry.ipAddress ?? "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <p className="border-t border-border px-6 py-3 text-xs text-muted-foreground">
        Exibindo os {Math.min(entries.length, PAGE_SIZE)} registros mais recentes.
      </p>
    </Panel>
  );
}

function AuditTableFallback() {
  return (
    <Panel className="space-y-4 p-6" aria-hidden>
      {Array.from({ length: 6 }, (_, index) => (
        <div key={index} className="flex gap-6">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-4 w-28" />
        </div>
      ))}
    </Panel>
  );
}
