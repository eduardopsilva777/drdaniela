import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { AuditEvent } from "@/components/audit/audit-event";
import { PageContainer, PageHeader, Panel } from "@/components/layout/page";
import { Skeleton } from "@/components/ui/skeleton";
import { ROLLOUT_STAGES } from "@/lib/app-modules";
import { hasPermission, ROLE_LABELS } from "@/lib/auth/permissions";
import {
  firstName,
  formatDateTime,
  formatDurationMinutes,
  formatLongDate,
  formatShortDateTime,
  greetingFor,
} from "@/lib/format";
import { getCurrentSession, requireUser } from "@/server/auth/dal";
import { getServerEnv } from "@/server/env";
import { getRecentAccessEvents } from "@/server/queries/audit";

export const metadata: Metadata = { title: "Dashboard" };

export default function DashboardPage() {
  return (
    <PageContainer>
      <Suspense fallback={<GreetingFallback />}>
        <Greeting />
      </Suspense>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] lg:gap-8">
        <div className="flex min-w-0 flex-col gap-6">
          <IndicatorsNotice />
          <RolloutPanel />
        </div>
        <div className="flex min-w-0 flex-col gap-6">
          <Suspense fallback={<PanelFallback />}>
            <SessionPanel />
          </Suspense>
          <Suspense fallback={null}>
            <RecentAccessPanel />
          </Suspense>
        </div>
      </div>
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

function PanelFallback() {
  return (
    <Panel className="space-y-4 p-6" aria-hidden>
      <Skeleton className="h-4 w-28" />
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-4/5" />
    </Panel>
  );
}

function StageTag({ stage }: { stage: number }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-2 self-start rounded-full border border-champagne/25 bg-champagne/[0.08] px-3 py-1 text-xs text-champagne">
      <span aria-hidden className="size-1.5 rounded-full bg-champagne" />
      Etapa {stage}
    </span>
  );
}

function IndicatorsNotice() {
  return (
    <Panel aria-labelledby="indicadores-titulo" className="p-6 sm:p-7">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 id="indicadores-titulo" className="text-base font-medium text-foreground">
            Indicadores da clínica
          </h2>
          <p className="mt-1.5 max-w-[58ch] text-sm leading-relaxed text-muted-foreground">
            Leads novos, agendamentos do dia, retornos próximos e taxa de conversão vão aparecer
            aqui, calculados com os dados reais dos módulos de leads, agenda e retornos.
          </p>
        </div>
        <StageTag stage={6} />
      </div>
    </Panel>
  );
}

function RolloutPanel() {
  return (
    <Panel aria-labelledby="implantacao-titulo" className="p-6 sm:p-7">
      <h2 id="implantacao-titulo" className="text-base font-medium text-foreground">
        Implantação do sistema
      </h2>
      <p className="mt-1.5 max-w-[58ch] text-sm leading-relaxed text-muted-foreground">
        Uma etapa só aparece como disponível quando funciona de ponta a ponta.
      </p>
      <ol className="mt-5 divide-y divide-border border-t border-border">
        {ROLLOUT_STAGES.map((item) => (
          <li
            key={item.stage}
            className="grid grid-cols-[1.75rem_minmax(0,1fr)_auto] items-baseline gap-x-3 py-3.5"
          >
            <span
              className={
                item.status === "available"
                  ? "font-display text-lg text-rose tabular-nums"
                  : "font-display text-lg text-muted-foreground/70 tabular-nums"
              }
            >
              {item.stage}
            </span>
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">{item.title}</p>
              <p className="mt-0.5 text-[0.8125rem] leading-snug text-muted-foreground">
                {item.detail}
              </p>
            </div>
            {item.status === "available" ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-sage/10 px-2.5 py-0.5 text-xs text-sage">
                <span aria-hidden className="size-1.5 rounded-full bg-sage" />
                Disponível
              </span>
            ) : (
              <span className="text-xs text-muted-foreground/80">Planejada</span>
            )}
          </li>
        ))}
      </ol>
    </Panel>
  );
}

async function SessionPanel() {
  const session = await getCurrentSession();
  if (!session) return null;
  const env = getServerEnv();

  return (
    <Panel aria-labelledby="sessao-titulo" className="p-6">
      <h2 id="sessao-titulo" className="text-base font-medium text-foreground">
        Sua sessão
      </h2>
      <dl className="mt-4 space-y-3 text-sm">
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-muted-foreground">Perfil de acesso</dt>
          <dd className="text-right text-foreground">{ROLE_LABELS[session.user.role]}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-muted-foreground">Válida até</dt>
          <dd className="text-right text-foreground tabular-nums">
            {formatDateTime(session.expiresAt, env.APP_TIMEZONE)}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-4">
          <dt className="text-muted-foreground">Encerra sem atividade após</dt>
          <dd className="text-right text-foreground">
            {formatDurationMinutes(env.SESSION_IDLE_TIMEOUT_MINUTES)}
          </dd>
        </div>
      </dl>
    </Panel>
  );
}

async function RecentAccessPanel() {
  const user = await requireUser();
  if (!hasPermission(user.role, "audit:read")) return null;

  const timeZone = getServerEnv().APP_TIMEZONE;
  const events = await getRecentAccessEvents(6);

  return (
    <Panel aria-labelledby="acessos-titulo" className="p-6">
      <div className="flex items-baseline justify-between gap-4">
        <h2 id="acessos-titulo" className="text-base font-medium text-foreground">
          Acessos recentes
        </h2>
        <Link
          href="/auditoria"
          className="text-sm text-rose underline-offset-4 hover:underline"
        >
          Ver auditoria
        </Link>
      </div>
      {events.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">Nenhum acesso registrado ainda.</p>
      ) : (
        <ul className="mt-4 space-y-3.5">
          {events.map((event) => (
            <li key={event.id} className="flex items-start justify-between gap-4 text-sm">
              <AuditEvent
                action={event.action}
                detail={[event.actorName, event.detail].filter(Boolean).join(", ") || null}
              />
              <time
                dateTime={event.createdAt.toISOString()}
                className="shrink-0 pt-px text-xs text-muted-foreground tabular-nums"
              >
                {formatShortDateTime(event.createdAt, timeZone)}
              </time>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
