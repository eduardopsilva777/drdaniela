import { Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { EmptyState } from "@/components/data/empty-state";
import { TableSkeleton } from "@/components/data/table-skeleton";
import { AccessDenied } from "@/components/layout/access-denied";
import { PageContainer, PageHeader, Panel } from "@/components/layout/page";
import { ProcedureActiveToggle } from "@/components/procedures/procedure-active-toggle";
import { ProcedureFormDialog } from "@/components/procedures/procedure-form-dialog";
import { StatusBadge } from "@/components/ui-kit/status-badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { hasPermission } from "@/lib/auth/permissions";
import { formatBRL } from "@/lib/money";
import { checkPermission, requireUser } from "@/server/auth/dal";
import { listProcedures } from "@/server/queries/catalog";

export const metadata: Metadata = { title: "Procedimentos" };

export default function ProceduresPage(props: PageProps<"/procedimentos">) {
  return (
    <PageContainer>
      <PageHeader
        title="Procedimentos"
        description="Catálogo de serviços da clínica: duração usada na agenda, preço de referência e intervalo de retorno definido pela profissional."
        actions={
          <Suspense fallback={null}>
            <NewProcedureButton />
          </Suspense>
        }
      />
      <Suspense fallback={<TableSkeleton />}>
        <ProceduresTable searchParams={props.searchParams} />
      </Suspense>
    </PageContainer>
  );
}

async function NewProcedureButton() {
  const user = await requireUser();
  if (!hasPermission(user.role, "procedures:manage")) return null;
  return (
    <ProcedureFormDialog
      trigger={
        <Button>
          <Plus aria-hidden />
          Novo procedimento
        </Button>
      }
    />
  );
}

async function ProceduresTable({ searchParams }: { searchParams: PageProps<"/procedimentos">["searchParams"] }) {
  const { user, allowed } = await checkPermission("procedures:read");
  if (!allowed) return <AccessDenied resource="o catálogo de procedimentos" />;

  const params = await searchParams;
  const includeInactive = params.inativos === "1";
  const procedures = await listProcedures(includeInactive);
  const canManage = hasPermission(user.role, "procedures:manage");

  return (
    <Panel aria-label="Procedimentos" className="overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-border px-6 py-3 text-sm">
        <p className="text-muted-foreground">
          {procedures.length} {procedures.length === 1 ? "procedimento" : "procedimentos"}
          {includeInactive ? " (incluindo inativos)" : " ativos"}
        </p>
        <Link
          href={includeInactive ? "/procedimentos" : "/procedimentos?inativos=1"}
          className="text-primary underline-offset-4 hover:underline"
        >
          {includeInactive ? "Mostrar só ativos" : "Mostrar inativos"}
        </Link>
      </div>

      {procedures.length === 0 ? (
        <EmptyState
          title="Nenhum procedimento cadastrado"
          description={
            canManage
              ? "Cadastre os serviços da clínica para usá-los em leads, na agenda e nos protocolos."
              : "A profissional responsável ainda não cadastrou os serviços da clínica."
          }
        />
      ) : (
        <div className="overflow-x-auto">
          <Table className="min-w-[46rem]">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-6 text-muted-foreground">Procedimento</TableHead>
                <TableHead className="text-muted-foreground">Duração</TableHead>
                <TableHead className="text-muted-foreground">Preço</TableHead>
                <TableHead className="text-muted-foreground">Retorno sugerido</TableHead>
                <TableHead className="text-muted-foreground">Situação</TableHead>
                {canManage ? <TableHead className="pr-6 text-right text-muted-foreground">Ações</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {procedures.map((procedure) => (
                <TableRow key={procedure.id} className={procedure.isActive ? undefined : "opacity-60"}>
                  <TableCell className="pl-6 align-top whitespace-normal">
                    <div className="flex items-start gap-3">
                      <span
                        aria-hidden
                        className="mt-1.5 size-2.5 shrink-0 rounded-full border border-border"
                        style={{ backgroundColor: procedure.color ?? "transparent" }}
                      />
                      <div className="min-w-0">
                        <p className="font-medium text-foreground">{procedure.name}</p>
                        {procedure.category ? (
                          <p className="text-xs text-muted-foreground">{procedure.category}</p>
                        ) : null}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="align-top tabular-nums">{procedure.durationMinutes} min</TableCell>
                  <TableCell className="align-top tabular-nums">
                    {procedure.priceCents !== null ? formatBRL(procedure.priceCents) : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="align-top tabular-nums">
                    {procedure.suggestedReturnDays !== null ? (
                      `${procedure.suggestedReturnDays} dias`
                    ) : (
                      <span className="text-muted-foreground">Não definido</span>
                    )}
                  </TableCell>
                  <TableCell className="align-top">
                    <StatusBadge
                      tone={procedure.isActive ? "success" : "muted"}
                      label={procedure.isActive ? "Ativo" : "Inativo"}
                    />
                  </TableCell>
                  {canManage ? (
                    <TableCell className="pr-6 text-right align-top">
                      <div className="flex justify-end gap-1">
                        <ProcedureFormDialog
                          procedure={procedure}
                          trigger={
                            <Button variant="ghost" size="sm">
                              Editar
                            </Button>
                          }
                        />
                        <ProcedureActiveToggle
                          procedureId={procedure.id}
                          name={procedure.name}
                          isActive={procedure.isActive}
                        />
                      </div>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Panel>
  );
}
