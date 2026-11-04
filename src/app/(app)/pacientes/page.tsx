import { Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { EmptyState } from "@/components/data/empty-state";
import { Pagination } from "@/components/data/pagination";
import { TableSkeleton } from "@/components/data/table-skeleton";
import { SearchFilter, SegmentedFilter, SelectFilter } from "@/components/data/url-filters";
import { AccessDenied } from "@/components/layout/access-denied";
import { PageContainer, PageHeader, Panel } from "@/components/layout/page";
import { PatientFormDialog } from "@/components/patients/patient-form-dialog";
import { StatusBadge } from "@/components/ui-kit/status-badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { hasPermission } from "@/lib/auth/permissions";
import { formatDateTime } from "@/lib/format";
import { formatPhone } from "@/lib/phone";
import { patientFiltersSchema } from "@/lib/validation/patients";
import { checkPermission, requireUser } from "@/server/auth/dal";
import { getServerEnv } from "@/server/env";
import { listPatients, PATIENTS_PAGE_SIZE } from "@/server/queries/patients";

export const metadata: Metadata = { title: "Pacientes" };

export default function PatientsPage(props: PageProps<"/pacientes">) {
  return (
    <PageContainer>
      <PageHeader
        title="Pacientes"
        description="Ficha de cada paciente com agenda, procedimentos, protocolos, retornos e conversas."
        actions={
          <Suspense fallback={null}>
            <NewPatientButton />
          </Suspense>
        }
      />
      <Suspense fallback={<Skeleton className="mb-6 h-9 w-full max-w-2xl" />}>
        <div className="mb-6 flex flex-wrap items-center gap-2.5">
          <SearchFilter placeholder="Buscar por nome, telefone ou e-mail" label="Buscar pacientes" className="w-full sm:w-80" />
          <SelectFilter
            param="ordem"
            label="Ordenar"
            allLabel="Nome (A–Z)"
            options={[
              { value: "recentes", label: "Cadastro mais recente" },
              { value: "antigos", label: "Cadastro mais antigo" },
            ]}
          />
          <div className="ml-auto">
            <SegmentedFilter
              param="situacao"
              label="Situação do cadastro"
              defaultValue="ativos"
              options={[
                { value: "ativos", label: "Ativos" },
                { value: "inativos", label: "Inativos" },
                { value: "todos", label: "Todos" },
              ]}
            />
          </div>
        </div>
      </Suspense>
      <Suspense fallback={<TableSkeleton rows={8} />}>
        <PatientTable searchParams={props.searchParams} />
      </Suspense>
    </PageContainer>
  );
}

async function NewPatientButton() {
  const user = await requireUser();
  if (!hasPermission(user.role, "patients:write")) return null;
  return (
    <PatientFormDialog
      trigger={
        <Button>
          <Plus aria-hidden />
          Novo paciente
        </Button>
      }
    />
  );
}

async function PatientTable({ searchParams }: { searchParams: PageProps<"/pacientes">["searchParams"] }) {
  const { allowed } = await checkPermission("patients:read");
  if (!allowed) return <AccessDenied resource="os pacientes" />;

  const filters = patientFiltersSchema.parse(await searchParams);
  const timeZone = getServerEnv().APP_TIMEZONE;
  const { total, items } = await listPatients(filters);

  if (total === 0) {
    return (
      <Panel>
        <EmptyState
          title={filters.busca ? "Nenhum paciente encontrado" : "Nenhum paciente cadastrado"}
          description={
            filters.busca
              ? "Confira a grafia ou busque pelo telefone."
              : "Pacientes entram por conversão de leads ou pelo botão “Novo paciente”."
          }
        />
      </Panel>
    );
  }

  return (
    <Panel aria-label="Lista de pacientes" className="overflow-hidden">
      <div className="overflow-x-auto">
        <Table className="min-w-[52rem]">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="pl-6 text-muted-foreground">Paciente</TableHead>
              <TableHead className="text-muted-foreground">Telefone</TableHead>
              <TableHead className="text-muted-foreground">Próximo agendamento</TableHead>
              <TableHead className="text-muted-foreground">Retornos pendentes</TableHead>
              <TableHead className="text-muted-foreground">WhatsApp</TableHead>
              <TableHead className="pr-6 text-muted-foreground">Situação</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((patient) => (
              <TableRow key={patient.id}>
                <TableCell className="pl-6">
                  <Link href={`/pacientes/${patient.id}`} className="font-medium text-foreground hover:underline hover:underline-offset-4">
                    {patient.fullName}
                  </Link>
                  {patient.preferredName ? <p className="text-xs text-muted-foreground">{patient.preferredName}</p> : null}
                </TableCell>
                <TableCell className="text-muted-foreground tabular-nums">{formatPhone(patient.phone)}</TableCell>
                <TableCell className="tabular-nums">
                  {patient.appointments[0] ? formatDateTime(patient.appointments[0].startsAt, timeZone) : <span className="text-muted-foreground">—</span>}
                </TableCell>
                <TableCell className="tabular-nums">
                  {patient._count.returns > 0 ? patient._count.returns : <span className="text-muted-foreground">—</span>}
                </TableCell>
                <TableCell className="text-muted-foreground">{patient.whatsappOptIn ? "Autorizado" : "Sem autorização"}</TableCell>
                <TableCell className="pr-6">
                  <StatusBadge tone={patient.isActive ? "sage" : "muted"} label={patient.isActive ? "Ativo" : "Inativo"} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <Pagination
        page={filters.pagina}
        pageSize={PATIENTS_PAGE_SIZE}
        total={total}
        basePath="/pacientes"
        params={{
          busca: filters.busca,
          situacao: filters.situacao === "ativos" ? undefined : filters.situacao,
          ordem: filters.ordem === "nome" ? undefined : filters.ordem,
        }}
      />
    </Panel>
  );
}
