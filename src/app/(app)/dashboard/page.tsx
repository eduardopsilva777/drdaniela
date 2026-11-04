import { AlertTriangle, ArrowDownRight, ArrowUpRight, CalendarClock, Minus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";

import { AuditEvent } from "@/components/audit/audit-event";
import { LeadsTrendChart } from "@/components/dashboard/leads-trend-chart";
import { SegmentedFilter } from "@/components/data/url-filters";
import { PageContainer, PageHeader, Panel } from "@/components/layout/page";
import { StatusBadge } from "@/components/ui-kit/status-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { hasPermission } from "@/lib/auth/permissions";
import {
  buildTrend,
  DASHBOARD_PERIODS,
  percentChange,
  PERIOD_LABELS,
  resolvePeriod,
  type DashboardPeriod,
} from "@/lib/dashboard-period";
import { dbDateToKey, formatKeyDate, formatKeyDayMonth, timeOf, todayKey } from "@/lib/datetime";
import { firstName, formatLongDate, formatShortDateTime, greetingFor } from "@/lib/format";
import {
  APPOINTMENT_STATUS_LABELS,
  APPOINTMENT_STATUS_TONES,
  FUNNEL_STAGES,
  LEAD_SOURCE_LABELS,
  LEAD_STATUS_LABELS,
} from "@/lib/labels";
import { describeDue, describeDueDateKey } from "@/lib/relative-dates";
import { cn } from "@/lib/utils";
import { checkPermission, requireUser } from "@/server/auth/dal";
import { getServerEnv } from "@/server/env";
import { getRecentAccessEvents } from "@/server/queries/audit";
import { getCommercialPerformance, getOperationalSnapshot } from "@/server/queries/dashboard";
import { getUpcomingCommercialActions } from "@/server/queries/leads";

export const metadata: Metadata = { title: "Dashboard" };

const NUMBER = new Intl.NumberFormat("pt-BR");
const PERCENT = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 1 });

type SearchParams = PageProps<"/dashboard">["searchParams"];

export default function DashboardPage(props: PageProps<"/dashboard">) {
  return (
    <PageContainer className="max-w-7xl">
      <Suspense fallback={<GreetingFallback />}>
        <Greeting />
      </Suspense>

      <Suspense fallback={<SectionFallback tiles={6} />}>
        <TodaySection />
      </Suspense>

      <section aria-labelledby="desempenho-titulo" className="mt-12">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="desempenho-titulo" className="text-lg font-medium text-foreground">
              Desempenho comercial
            </h2>
            <p className="text-sm text-muted-foreground">Leads criados no período e o que aconteceu com eles.</p>
          </div>
          <Suspense fallback={<Skeleton className="h-9 w-72" />}>
            <SegmentedFilter
              param="periodo"
              label="Período dos indicadores"
              defaultValue="30d"
              options={DASHBOARD_PERIODS.map((value) => ({ value, label: PERIOD_LABELS[value] }))}
            />
          </Suspense>
        </div>
        <Suspense fallback={<SectionFallback tiles={4} />}>
          <PerformanceSection searchParams={props.searchParams} />
        </Suspense>
      </section>

      <Suspense fallback={null}>
        <RecentAccessPanel />
      </Suspense>
    </PageContainer>
  );
}

async function Greeting() {
  const user = await requireUser();
  const timeZone = getServerEnv().APP_TIMEZONE;
  const now = new Date();
  return (
    <PageHeader
      title={`${greetingFor(now, timeZone)}, ${firstName(user.name)}`}
      description={formatLongDate(now, timeZone)}
    />
  );
}

function GreetingFallback() {
  return (
    <div className="space-y-3 pb-8 lg:pb-10" aria-hidden>
      <Skeleton className="h-10 w-72 max-w-full rounded-lg" />
      <Skeleton className="h-4 w-56" />
    </div>
  );
}

function SectionFallback({ tiles }: { tiles: number }) {
  return (
    <div className="space-y-6" aria-hidden>
      <div className={cn("grid gap-3 sm:grid-cols-2", tiles > 4 ? "lg:grid-cols-3 xl:grid-cols-6" : "lg:grid-cols-4")}>
        {Array.from({ length: tiles }, (_, index) => (
          <Skeleton key={index} className="h-[6.5rem] rounded-2xl" />
        ))}
      </div>
      <Skeleton className="h-72 rounded-2xl" />
    </div>
  );
}

// -----------------------------------------------------------------------------
// Peças
// -----------------------------------------------------------------------------

function StatTile({
  label,
  value,
  href,
  hint,
  hintTone = "muted",
  delta,
}: {
  label: string;
  value: string;
  href: string;
  hint?: ReactNode;
  hintTone?: "muted" | "brick";
  delta?: { change: number | null; upIsGood: boolean; label: string };
}) {
  return (
    <Link
      href={href}
      className="group flex flex-col rounded-2xl border border-border bg-card px-5 py-4 outline-none transition-colors hover:border-rose/40 focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="mt-1.5 text-3xl font-semibold tracking-tight text-foreground">{value}</span>
      {delta ? <Delta {...delta} /> : null}
      {hint ? (
        <span className={cn("mt-1 text-xs", hintTone === "brick" ? "text-brick" : "text-muted-foreground")}>{hint}</span>
      ) : null}
    </Link>
  );
}

function Delta({ change, upIsGood, label }: { change: number | null; upIsGood: boolean; label: string }) {
  if (change === null) return <span className="mt-1 text-xs text-muted-foreground">Sem base de comparação</span>;
  const Icon = change > 0 ? ArrowUpRight : change < 0 ? ArrowDownRight : Minus;
  const good = change === 0 ? null : change > 0 === upIsGood;
  return (
    <span className={cn("mt-1 inline-flex items-center gap-1 text-xs", good === null ? "text-muted-foreground" : good ? "text-sage" : "text-brick")}>
      <Icon aria-hidden className="size-3.5" />
      {change > 0 ? "+" : ""}
      {change}% <span className="text-muted-foreground">{label}</span>
    </span>
  );
}

function Card({ title, action, children, className }: { title: string; action?: ReactNode; children: ReactNode; className?: string }) {
  const id = `card-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <Panel aria-labelledby={id} className={cn("flex min-w-0 flex-col p-6", className)}>
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h3 id={id} className="text-base font-medium text-foreground">
          {title}
        </h3>
        {action}
      </div>
      {children}
    </Panel>
  );
}

function CardLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="shrink-0 text-sm text-rose underline-offset-4 hover:underline">
      {children}
    </Link>
  );
}

/** Barra horizontal fina (dado) com rótulo e valor em texto. */
function BarRow({ label, value, share, width }: { label: string; value: number; share?: number | null; width: number }) {
  return (
    <li className="grid grid-cols-[minmax(0,8.5rem)_minmax(0,1fr)_auto] items-center gap-3 text-sm">
      <span className="truncate text-foreground/90">{label}</span>
      <span className="h-2.5 min-w-0">
        <span
          className="block h-full rounded-r-[4px] bg-chart-accent"
          style={{ width: `${Math.max(width, value > 0 ? 1.5 : 0)}%` }}
        />
      </span>
      <span className="text-right text-muted-foreground tabular-nums">
        <span className="text-foreground">{NUMBER.format(value)}</span>
        {share !== undefined && share !== null ? ` · ${PERCENT.format(share)}` : ""}
      </span>
    </li>
  );
}

// -----------------------------------------------------------------------------
// Hoje (não depende do período)
// -----------------------------------------------------------------------------

async function TodaySection() {
  const { user, allowed } = await checkPermission("dashboard:view");
  if (!allowed) return null;
  const canSee =
    hasPermission(user.role, "appointments:read") &&
    hasPermission(user.role, "returns:read") &&
    hasPermission(user.role, "patients:read") &&
    hasPermission(user.role, "leads:read");
  if (!canSee) return null;

  const timeZone = getServerEnv().APP_TIMEZONE;
  const now = new Date();
  const today = todayKey(timeZone, now);
  const [snapshot, actions] = await Promise.all([
    getOperationalSnapshot(now, today, timeZone),
    getUpcomingCommercialActions(now, 3, 8),
  ]);
  const confirmed = snapshot.todayAppointments.filter((item) => item.status === "CONFIRMED").length;

  return (
    <section aria-labelledby="hoje-titulo">
      <h2 id="hoje-titulo" className="sr-only">
        Hoje na clínica
      </h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <StatTile
          label="Agendamentos hoje"
          value={NUMBER.format(snapshot.todayAppointments.length)}
          href="/agenda?visao=dia"
          hint={snapshot.todayAppointments.length > 0 ? `${confirmed} confirmado(s)` : "Agenda livre"}
        />
        <StatTile label="Próximos 7 dias" value={NUMBER.format(snapshot.upcomingCount)} href="/agenda" hint="agendamentos ativos" />
        <StatTile
          label="Retornos pendentes"
          value={NUMBER.format(snapshot.pendingReturns)}
          href="/protocolos"
          hint={snapshot.overdueReturns > 0 ? `${snapshot.overdueReturns} atrasado(s)` : "Nenhum atrasado"}
          hintTone={snapshot.overdueReturns > 0 ? "brick" : "muted"}
        />
        <StatTile label="Pacientes ativos" value={NUMBER.format(snapshot.activePatients)} href="/pacientes" />
        <StatTile
          label="Leads em atendimento"
          value={NUMBER.format(snapshot.leadsInProgress)}
          href="/leads"
          hint={`${NUMBER.format(snapshot.leadsOpen)} em aberto no funil`}
        />
        <StatTile label="Leads totais" value={NUMBER.format(snapshot.leadsTotal)} href="/leads?visao=lista" hint="todas as etapas" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card title="Agenda de hoje" action={<CardLink href="/agenda?visao=dia">Abrir agenda</CardLink>}>
          {snapshot.todayAppointments.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum atendimento hoje.</p>
          ) : (
            <ul className="space-y-3">
              {snapshot.todayAppointments.slice(0, 8).map((item) => {
                const name = item.patient?.fullName ?? item.lead?.name ?? "—";
                return (
                  <li key={item.id} className="flex items-start gap-3 text-sm">
                    <span className="w-11 shrink-0 pt-px text-muted-foreground tabular-nums">{timeOf(item.startsAt, timeZone)}</span>
                    <span
                      aria-hidden
                      className="mt-1.5 size-2 shrink-0 rounded-full"
                      style={{ backgroundColor: item.procedure?.color ?? "var(--chart-accent)" }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-foreground">{name}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {item.procedure?.name ?? "Avaliação"} · {item.professional.name}
                      </span>
                    </span>
                    <StatusBadge tone={APPOINTMENT_STATUS_TONES[item.status]} label={APPOINTMENT_STATUS_LABELS[item.status]} />
                  </li>
                );
              })}
              {snapshot.todayAppointments.length > 8 ? (
                <li className="text-xs text-muted-foreground">e mais {snapshot.todayAppointments.length - 8} na agenda.</li>
              ) : null}
            </ul>
          )}
        </Card>

        <Card title="Próximas ações comerciais" action={<CardLink href="/leads?visao=lista&ordem=proxima_acao">Ver leads</CardLink>}>
          {actions.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma ação vencida ou para os próximos 3 dias.</p>
          ) : (
            <ul className="space-y-3">
              {actions.map((lead) => {
                const due = lead.nextActionAt ? describeDue(lead.nextActionAt, timeZone, now) : null;
                return (
                  <li key={lead.id} className="flex items-start gap-3 text-sm">
                    <CalendarClock aria-hidden className={cn("mt-0.5 size-4 shrink-0", due?.overdue ? "text-brick" : "text-muted-foreground")} />
                    <span className="min-w-0 flex-1">
                      <Link href={`/leads/${lead.id}`} className="block truncate text-foreground hover:underline hover:underline-offset-4">
                        {lead.name}
                      </Link>
                      <span className="block truncate text-xs text-muted-foreground">
                        {lead.nextActionNote ?? LEAD_STATUS_LABELS[lead.status]}
                      </span>
                    </span>
                    {due ? (
                      <span className={cn("shrink-0 text-xs tabular-nums", due.overdue ? "text-brick" : "text-muted-foreground")}>
                        {due.label}
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card title="Retornos atrasados" action={<CardLink href="/protocolos?situacao=atrasados">Ver todos</CardLink>}>
          {snapshot.overdueList.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum retorno atrasado.</p>
          ) : (
            <ul className="space-y-3" role="list">
              {snapshot.overdueList.map((item) => {
                const dueKey = dbDateToKey(item.dueDate);
                return (
                  <li key={item.id} className="flex items-start gap-3 text-sm">
                    <AlertTriangle aria-label="Atrasado" className="mt-0.5 size-4 shrink-0 text-brick" />
                    <span className="min-w-0 flex-1">
                      <Link
                        href={`/pacientes/${item.patient.id}?aba=protocolos`}
                        className="block truncate text-foreground hover:underline hover:underline-offset-4"
                      >
                        {item.patient.fullName}
                      </Link>
                      <span className="block truncate text-xs text-muted-foreground">
                        {item.title} · previsto {formatKeyDate(dueKey)}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs text-brick tabular-nums">{describeDueDateKey(dueKey, today).label}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </section>
  );
}

// -----------------------------------------------------------------------------
// Desempenho comercial (escopo do filtro de período)
// -----------------------------------------------------------------------------

async function PerformanceSection({ searchParams }: { searchParams: SearchParams }) {
  const { user, allowed } = await checkPermission("dashboard:view");
  if (!allowed || !hasPermission(user.role, "leads:read")) return null;

  const params = await searchParams;
  const requested = typeof params.periodo === "string" ? params.periodo : "30d";
  const period: DashboardPeriod = (DASHBOARD_PERIODS as readonly string[]).includes(requested)
    ? (requested as DashboardPeriod)
    : "30d";
  const timeZone = getServerEnv().APP_TIMEZONE;
  const today = todayKey(timeZone);
  const range = resolvePeriod(period, today, timeZone);
  const data = await getCommercialPerformance(range, timeZone);
  const trend = buildTrend(range, data.dailyCounts);
  const periodText = `${formatKeyDayMonth(range.firstDay)} a ${formatKeyDayMonth(range.lastDay)}`;
  const topSource = data.bySource[0]?.total ?? 0;

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Leads novos"
          value={NUMBER.format(data.newLeads)}
          href="/leads?visao=lista"
          delta={{ change: percentChange(data.newLeads, data.previousNewLeads), upIsGood: true, label: range.comparisonLabel }}
        />
        <StatTile
          label="Taxa de conversão"
          value={data.conversionRate === null ? "—" : PERCENT.format(data.conversionRate)}
          href="/leads"
          hint={
            data.newLeads > 0
              ? `${NUMBER.format(data.cohortConverted)} de ${NUMBER.format(data.newLeads)} leads do período já são pacientes`
              : "Sem leads no período"
          }
        />
        <StatTile
          label="Convertidos no período"
          value={NUMBER.format(data.convertedInPeriod)}
          href="/pacientes?ordem=recentes"
          hint={`${NUMBER.format(data.lostInPeriod)} perdido(s) no período`}
        />
        <StatTile
          label="Procedimentos realizados"
          value={NUMBER.format(data.proceduresPerformed)}
          href="/agenda"
          delta={{
            change: percentChange(data.proceduresPerformed, data.previousProceduresPerformed),
            upIsGood: true,
            label: range.comparisonLabel,
          }}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Card title="Evolução de leads novos" action={<span className="text-xs text-muted-foreground tabular-nums">{periodText}</span>}>
          <p className="-mt-2 mb-4 text-xs text-muted-foreground">
            {range.bucket === "week" ? "Leads criados por semana." : "Leads criados por dia."}
          </p>
          <LeadsTrendChart data={trend} caption={`Leads novos ${range.bucket === "week" ? "por semana" : "por dia"}, ${periodText}`} />
        </Card>

        <Card title="Conversão por etapa do funil">
          <p className="-mt-2 mb-5 text-xs text-muted-foreground">
            Dos leads criados no período, quantos chegaram a cada etapa (inclui os que depois foram perdidos).
          </p>
          {data.newLeads === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum lead criado no período.</p>
          ) : (
            <ol className="space-y-4">
              {FUNNEL_STAGES.map((stage) => {
                const value = data.funnel[stage as keyof typeof data.funnel];
                const share = value / data.newLeads;
                return <BarRow key={stage} label={LEAD_STATUS_LABELS[stage]} value={value} share={share} width={share * 100} />;
              })}
            </ol>
          )}
        </Card>
      </div>

      <Card title="Origem dos leads" action={<span className="text-xs text-muted-foreground tabular-nums">{periodText}</span>}>
        {data.bySource.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum lead criado no período.</p>
        ) : (
          <ul className="grid gap-x-10 gap-y-4 md:grid-cols-2">
            {data.bySource.map((row) => (
              <BarRow
                key={row.source}
                label={LEAD_SOURCE_LABELS[row.source]}
                value={row.total}
                share={row.total / data.newLeads}
                width={topSource > 0 ? (row.total / topSource) * 100 : 0}
              />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Segurança (administração)
// -----------------------------------------------------------------------------

async function RecentAccessPanel() {
  const user = await requireUser();
  if (!hasPermission(user.role, "audit:read")) return null;

  const timeZone = getServerEnv().APP_TIMEZONE;
  const events = await getRecentAccessEvents(6);

  return (
    <Panel aria-labelledby="acessos-titulo" className="mt-12 p-6">
      <div className="flex items-baseline justify-between gap-4">
        <h2 id="acessos-titulo" className="text-base font-medium text-foreground">
          Acessos recentes
        </h2>
        <Link href="/auditoria" className="text-sm text-rose underline-offset-4 hover:underline">
          Ver auditoria
        </Link>
      </div>
      {events.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">Nenhum acesso registrado ainda.</p>
      ) : (
        <ul className="mt-4 grid gap-x-10 gap-y-3.5 md:grid-cols-2">
          {events.map((event) => (
            <li key={event.id} className="flex items-start justify-between gap-4 text-sm">
              <AuditEvent action={event.action} detail={[event.actorName, event.detail].filter(Boolean).join(", ") || null} />
              <time dateTime={event.createdAt.toISOString()} className="shrink-0 pt-px text-xs text-muted-foreground tabular-nums">
                {formatShortDateTime(event.createdAt, timeZone)}
              </time>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
