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
import { LeadBoard, type BoardColumnData } from "@/components/leads/lead-board";
import { LeadFormDialog } from "@/components/leads/lead-form-dialog";
import { StatusBadge } from "@/components/ui-kit/status-badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { hasPermission } from "@/lib/auth/permissions";
import { formatDateTime, initials } from "@/lib/format";
import {
  LEAD_PRIORITY_LABELS,
  LEAD_PRIORITY_TONES,
  LEAD_SOURCE_LABELS,
  LEAD_STATUS_LABELS,
  LEAD_STATUS_TONES,
} from "@/lib/labels";
import { formatPhone } from "@/lib/phone";
import { describeDue } from "@/lib/relative-dates";
import { cn } from "@/lib/utils";
import { leadFiltersSchema, type LeadFilters } from "@/lib/validation/leads";
import { checkPermission, requireUser } from "@/server/auth/dal";
import { getServerEnv } from "@/server/env";
import { getActiveProcedureOptions, getStaffOptions } from "@/server/queries/catalog";
import {
  CLOSED_COLUMNS_WINDOW_DAYS,
  getLeadBoard,
  getLeadTable,
  LEADS_PAGE_SIZE,
  type LeadCardView,
} from "@/server/queries/leads";

export const metadata: Metadata = { title: "Leads" };

type SearchParams = PageProps<"/leads">["searchParams"];

export default function LeadsPage(props: PageProps<"/leads">) {
  return (
    <PageContainer className="max-w-[100rem]">
      <PageHeader
        title="Leads"
        description="Cada pessoa interessada, do primeiro contato até virar paciente. Arraste os cartões entre as etapas ou use o menu de cada cartão."
        actions={
          <Suspense fallback={null}>
            <NewLeadButton />
          </Suspense>
        }
      />
      <Suspense fallback={<Skeleton className="mb-6 h-9 w-full max-w-3xl" />}>
        <LeadFiltersBar searchParams={props.searchParams} />
      </Suspense>
      <Suspense fallback={<TableSkeleton rows={8} />}>
        <LeadsContent searchParams={props.searchParams} />
      </Suspense>
    </PageContainer>
  );
}

async function NewLeadButton() {
  const user = await requireUser();
  if (!hasPermission(user.role, "leads:write")) return null;
  const [procedures, staff] = await Promise.all([getActiveProcedureOptions(), getStaffOptions()]);
  return (
    <LeadFormDialog
      procedures={procedures.map((item) => ({ value: item.id, label: item.name }))}
      staff={staff.map((item) => ({ value: item.id, label: item.name }))}
      trigger={
        <Button>
          <Plus aria-hidden />
          Novo lead
        </Button>
      }
    />
  );
}

async function LeadFiltersBar({ searchParams }: { searchParams: SearchParams }) {
  const [staff, params] = await Promise.all([getStaffOptions(), searchParams]);
  const filters = leadFiltersSchema.parse(params);
  const isList = filters.visao === "lista";

  return (
    <div className="mb-6 flex flex-wrap items-center gap-2.5">
      <SearchFilter placeholder="Buscar por nome, telefone ou e-mail" label="Buscar leads" className="w-full sm:w-72" />
      <SelectFilter
        param="origem"
        label="Filtrar por origem"
        allLabel="Todas as origens"
        options={Object.entries(LEAD_SOURCE_LABELS).map(([value, label]) => ({ value, label }))}
      />
      <SelectFilter
        param="responsavel"
        label="Filtrar por responsável"
        allLabel="Todos os responsáveis"
        options={[{ value: "sem", label: "Sem responsável" }, ...staff.map((item) => ({ value: item.id, label: item.name }))]}
      />
      <SelectFilter
        param="prioridade"
        label="Filtrar por prioridade"
        allLabel="Todas as prioridades"
        options={Object.entries(LEAD_PRIORITY_LABELS).map(([value, label]) => ({ value, label: `Prioridade ${label.toLowerCase()}` }))}
      />
      {isList ? (
        <>
          <SelectFilter
            param="status"
            label="Filtrar por etapa"
            allLabel="Todas as etapas"
            options={Object.entries(LEAD_STATUS_LABELS).map(([value, label]) => ({ value, label }))}
          />
          <SelectFilter
            param="ordem"
            label="Ordenar"
            allLabel="Mais recentes"
            options={[
              { value: "antigos", label: "Mais antigos" },
              { value: "nome", label: "Nome (A–Z)" },
              { value: "proxima_acao", label: "Próxima ação" },
              { value: "prioridade", label: "Prioridade" },
            ]}
          />
        </>
      ) : null}
      <div className="ml-auto">
        <SegmentedFilter
          param="visao"
          label="Forma de visualização"
          defaultValue="funil"
          options={[
            { value: "funil", label: "Funil" },
            { value: "lista", label: "Lista" },
          ]}
        />
      </div>
    </div>
  );
}

function toBoardCard(lead: LeadCardView, timeZone: string, now: Date) {
  return {
    id: lead.id,
    name: lead.name,
    phoneLabel: formatPhone(lead.phone),
    email: lead.email,
    whatsappOptIn: lead.whatsappOptIn,
    status: lead.status,
    priority: lead.priority,
    sourceLabel: LEAD_SOURCE_LABELS[lead.source],
    interest: lead.interest,
    ownerName: lead.ownerName,
    ownerInitials: lead.ownerName ? initials(lead.ownerName) : null,
    nextAction: lead.nextActionAt ? describeDue(lead.nextActionAt, timeZone, now) : null,
    lostReason: lead.lostReason,
  };
}

async function LeadsContent({ searchParams }: { searchParams: SearchParams }) {
  const { allowed } = await checkPermission("leads:read");
  if (!allowed) return <AccessDenied resource="os leads" />;

  const filters = leadFiltersSchema.parse(await searchParams);
  const timeZone = getServerEnv().APP_TIMEZONE;
  const now = new Date();

  if (filters.visao === "lista") {
    return <LeadTable filters={filters} timeZone={timeZone} now={now} />;
  }

  const board = await getLeadBoard(filters, now);
  const columns: BoardColumnData[] = board.map((column) => ({
    status: column.status,
    total: column.total,
    items: column.items.map((lead) => toBoardCard(lead, timeZone, now)),
  }));
  return <LeadBoard columns={columns} closedWindowDays={CLOSED_COLUMNS_WINDOW_DAYS} />;
}

async function LeadTable({ filters, timeZone, now }: { filters: LeadFilters; timeZone: string; now: Date }) {
  const { total, items } = await getLeadTable(filters);

  if (total === 0) {
    return (
      <Panel>
        <EmptyState
          title="Nenhum lead encontrado"
          description="Ajuste os filtros ou cadastre um novo lead pelo botão no topo da página."
        />
      </Panel>
    );
  }

  return (
    <Panel aria-label="Lista de leads" className="overflow-hidden">
      <div className="overflow-x-auto">
        <Table className="min-w-[60rem]">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="pl-6 text-muted-foreground">Lead</TableHead>
              <TableHead className="text-muted-foreground">Etapa</TableHead>
              <TableHead className="text-muted-foreground">Origem</TableHead>
              <TableHead className="text-muted-foreground">Interesse</TableHead>
              <TableHead className="text-muted-foreground">Prioridade</TableHead>
              <TableHead className="text-muted-foreground">Próxima ação</TableHead>
              <TableHead className="text-muted-foreground">Responsável</TableHead>
              <TableHead className="pr-6 text-muted-foreground">Criado em</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((lead) => {
              const due = lead.nextActionAt ? describeDue(lead.nextActionAt, timeZone, now) : null;
              return (
                <TableRow key={lead.id}>
                  <TableCell className="pl-6">
                    <Link href={`/leads/${lead.id}`} className="font-medium text-foreground hover:underline hover:underline-offset-4">
                      {lead.name}
                    </Link>
                    <p className="text-xs text-muted-foreground tabular-nums">{formatPhone(lead.phone)}</p>
                  </TableCell>
                  <TableCell>
                    <StatusBadge tone={LEAD_STATUS_TONES[lead.status]} label={LEAD_STATUS_LABELS[lead.status]} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">{LEAD_SOURCE_LABELS[lead.source]}</TableCell>
                  <TableCell className="max-w-56 truncate">{lead.interest ?? <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell>
                    <StatusBadge tone={LEAD_PRIORITY_TONES[lead.priority]} label={LEAD_PRIORITY_LABELS[lead.priority]} />
                  </TableCell>
                  <TableCell className={cn("tabular-nums", due?.overdue ? "text-destructive" : "text-muted-foreground")}>
                    {due ? due.label : "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{lead.ownerName ?? "—"}</TableCell>
                  <TableCell className="pr-6 text-muted-foreground tabular-nums">
                    {formatDateTime(lead.createdAt, timeZone)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <Pagination
        page={filters.pagina}
        pageSize={LEADS_PAGE_SIZE}
        total={total}
        basePath="/leads"
        params={{
          visao: "lista",
          busca: filters.busca,
          origem: filters.origem,
          responsavel: filters.responsavel,
          status: filters.status,
          prioridade: filters.prioridade,
          ordem: filters.ordem === "recentes" ? undefined : filters.ordem,
        }}
      />
    </Panel>
  );
}
