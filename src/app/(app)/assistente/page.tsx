import { Bot, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";

import {
  ArchiveEntryButton,
  DismissGapButton,
  KnowledgeEntryDialog,
  KnowledgeHistoryDialog,
  KnowledgeTestPanel,
} from "@/components/assistant/knowledge-dialogs";
import { AssistantSettingsForm } from "@/components/assistant/settings-form";
import { SyncTemplatesButton, TemplateFormDialog, TemplateStatusDialog } from "@/components/assistant/template-dialogs";
import { EmptyState } from "@/components/data/empty-state";
import { Pagination } from "@/components/data/pagination";
import { TableSkeleton } from "@/components/data/table-skeleton";
import { SearchFilter, SegmentedFilter, SelectFilter } from "@/components/data/url-filters";
import { AccessDenied } from "@/components/layout/access-denied";
import { PageContainer, PageHeader, Panel } from "@/components/layout/page";
import { StatusBadge } from "@/components/ui-kit/status-badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { hasPermission } from "@/lib/auth/permissions";
import { startOfMonthKey, todayKey, zonedDateTime } from "@/lib/datetime";
import { formatShortDateTime } from "@/lib/format";
import {
  ASSISTANT_OUTCOME_LABELS,
  ASSISTANT_OUTCOME_TONES,
  CONSENT_PURPOSE_LABELS,
  CONSENT_SOURCE_LABELS,
  KNOWLEDGE_CATEGORY_LABELS,
  KNOWLEDGE_GAP_REASON_LABELS,
  KNOWLEDGE_VERSION_STATUS_LABELS,
  KNOWLEDGE_VERSION_STATUS_TONES,
  MESSAGE_ORIGIN_LABELS,
  REMINDER_KIND_LABELS,
  TEMPLATE_CATEGORY_LABELS,
  TEMPLATE_PARAMETER_LABELS,
  TEMPLATE_STATUS_LABELS,
  TEMPLATE_STATUS_TONES,
  TEMPLATE_USAGE_LABELS,
  type TemplateParameter,
} from "@/lib/labels";
import { formatPhone } from "@/lib/phone";
import { cn } from "@/lib/utils";
import { assistantFiltersSchema, type AssistantFilters, type AssistantTab } from "@/lib/validation/assistant";
import type { KnowledgeCategory } from "@/generated/prisma/enums";
import { getAssistantEngineStatus } from "@/server/assistant/runtime";
import { checkPermission } from "@/server/auth/dal";
import type { SessionUser } from "@/server/auth/session-store";
import { getDb } from "@/server/db";
import { getServerEnv } from "@/server/env";
import {
  ASSISTANT_PAGE_SIZE,
  getAiUsageOverview,
  getAssistantOverview,
  getAutomationLogs,
  getConsentOverview,
  listKnowledgeEntries,
  listKnowledgeGaps,
  listMessageTemplates,
} from "@/server/queries/assistant";
import { getActiveProcedureOptions, getProfessionalOptions } from "@/server/queries/catalog";
import { getAssistantConfig, getAssistantSettingsMeta } from "@/server/services/assistant-settings";
import { getWhatsAppIntegrationStatus } from "@/server/whatsapp/provider";

export const metadata: Metadata = { title: "Assistente virtual" };

type SearchParams = PageProps<"/assistente">["searchParams"];

const TABS: Array<{ value: AssistantTab; label: string }> = [
  { value: "visao-geral", label: "Visão geral" },
  { value: "conhecimento", label: "Base de conhecimento" },
  { value: "pendencias", label: "Perguntas sem resposta" },
  { value: "configuracoes", label: "Configurações" },
  { value: "modelos", label: "Modelos da Meta" },
  { value: "consentimentos", label: "Consentimentos" },
  { value: "registros", label: "Registros" },
];

export default function AssistantPage(props: PageProps<"/assistente">) {
  return (
    <PageContainer className="max-w-7xl">
      <PageHeader
        title="Assistente virtual"
        description="O assistente do WhatsApp responde só com o que a equipe aprovou, coleta o mínimo para o cadastro, agenda com confirmação e chama a equipe quando não pode responder com segurança. Nenhuma conversa treina modelos."
      />
      <Suspense fallback={<Skeleton className="mb-6 h-10 w-full max-w-3xl" />}>
        <TabsNav searchParams={props.searchParams} />
      </Suspense>
      <Suspense fallback={<TableSkeleton rows={8} />}>
        <AssistantContent searchParams={props.searchParams} />
      </Suspense>
    </PageContainer>
  );
}

async function TabsNav({ searchParams }: { searchParams: SearchParams }) {
  const filters = assistantFiltersSchema.parse(await searchParams);
  return (
    <nav aria-label="Seções do assistente" className="mb-6 overflow-x-auto">
      <ul className="flex min-w-max gap-1 border-b border-border">
        {TABS.map((tab) => (
          <li key={tab.value}>
            <Link
              href={tab.value === "visao-geral" ? "/assistente" : `/assistente?aba=${tab.value}`}
              aria-current={filters.aba === tab.value ? "page" : undefined}
              className={cn(
                "-mb-px inline-flex h-10 items-center border-b-2 px-3 text-sm transition-colors",
                filters.aba === tab.value ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

async function AssistantContent({ searchParams }: { searchParams: SearchParams }) {
  const filters = assistantFiltersSchema.parse(await searchParams);
  const permission =
    filters.aba === "visao-geral" || filters.aba === "registros"
      ? "assistant:monitor"
      : filters.aba === "configuracoes"
        ? "knowledge:read"
        : filters.aba === "modelos" || filters.aba === "consentimentos"
          ? "whatsapp:read"
          : "knowledge:read";
  const { user, allowed } = await checkPermission(permission);
  if (!allowed) return <AccessDenied resource="esta seção do assistente" />;

  switch (filters.aba) {
    case "conhecimento":
      return <KnowledgeTab filters={filters} user={user} />;
    case "pendencias":
      return <GapsTab filters={filters} user={user} />;
    case "configuracoes":
      return <SettingsTab user={user} />;
    case "modelos":
      return <TemplatesTab user={user} />;
    case "consentimentos":
      return <ConsentsTab page={filters.pagina} />;
    case "registros":
      return <LogsTab />;
    default:
      return <OverviewTab filters={filters} />;
  }
}

// -----------------------------------------------------------------------------
// Visão geral
// -----------------------------------------------------------------------------

function Tile({ label, value, hint, href }: { label: string; value: ReactNode; hint?: string; href?: string }) {
  const content = (
    <>
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-metric text-foreground tabular-nums">{value}</dd>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </>
  );
  return href ? (
    <Link href={href} className="block rounded-xl border border-border bg-card px-[1.125rem] py-4 transition-colors hover:border-primary/40">
      {content}
    </Link>
  ) : (
    <div className="rounded-xl border border-border bg-card px-[1.125rem] py-4">{content}</div>
  );
}

function formatSeconds(seconds: number | null): string {
  if (seconds === null) return "—";
  if (seconds < 60) return `${Math.round(seconds)} s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  return `${(seconds / 3600).toFixed(1).replace(".", ",")} h`;
}

function percent(part: number, total: number): string {
  return total > 0 ? `${Math.round((part / total) * 100)}%` : "—";
}

const USD = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const COMPACT = new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 });

function formatUsd(micros: number): string {
  return USD.format(micros / 1_000_000);
}

/** Nomes das ferramentas do CRM usadas pela IA, como a equipe entende. */
const TOOL_LABELS: Record<string, string> = {
  search_knowledge: "Consultou a base aprovada",
  list_services: "Consultou procedimentos",
  check_availability: "Consultou horários",
  register_lead: "Cadastrou/atualizou lead",
  update_lead: "Atualizou lead",
  register_opportunity: "Registrou oportunidade",
  list_my_appointments: "Listou agendamentos do contato",
  propose_booking: "Propôs agendamento",
  propose_reschedule: "Propôs remarcação",
  propose_cancellation: "Propôs cancelamento",
  confirm_pending_action: "Executou ação confirmada",
  discard_pending_action: "Descartou proposta",
  confirm_attendance: "Registrou confirmação de presença",
  create_staff_task: "Criou tarefa para a equipe",
  save_conversation_notes: "Atualizou notas da conversa",
  request_human: "Transferiu para a equipe",
  record_return_response: "Registrou resposta a retorno",
  opt_out_contact: "Descadastrou o contato",
};

async function AiUsageSection({ periodDays }: { periodDays: number }) {
  const env = getServerEnv();
  const monthStart = zonedDateTime(startOfMonthKey(todayKey(env.APP_TIMEZONE)), "00:00", env.APP_TIMEZONE);
  const [usage, config] = await Promise.all([getAiUsageOverview(periodDays, monthStart), getAssistantConfig(getDb())]);
  const budgetMicros = Math.round(config.agent.monthlyBudgetUsd * 1_000_000);
  const followUpsSent = usage.followUps.COMPLETED ?? 0;
  const followUpsSkipped = usage.followUps.SKIPPED ?? 0;
  return (
    <section aria-labelledby="metrics-ai" className="space-y-3">
      <h2 id="metrics-ai" className="text-sm font-semibold text-foreground">
        IA conversacional — consumo e custo estimado
      </h2>
      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile
          label="Gasto estimado no mês"
          value={formatUsd(usage.monthCostMicros)}
          hint={`Limite: ${formatUsd(budgetMicros)} (${percent(usage.monthCostMicros, budgetMicros)}) · no período: ${formatUsd(usage.costMicros)}`}
          href="/assistente?aba=configuracoes"
        />
        <Tile
          label="Mensagens respondidas pela IA"
          value={usage.turns}
          hint={`${usage.modelCalls} chamada(s) ao modelo · média ${usage.avgModelLatencyMs !== null ? `${(usage.avgModelLatencyMs / 1000).toFixed(1).replace(".", ",")} s` : "—"}`}
        />
        <Tile
          label="Tokens no período"
          value={COMPACT.format(usage.inputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheWriteTokens)}
          hint={`Entrada ${COMPACT.format(usage.inputTokens)} · saída ${COMPACT.format(usage.outputTokens)} · cache ${COMPACT.format(usage.cacheReadTokens)}`}
        />
        <Tile
          label="Acompanhamentos da IA"
          value={followUpsSent}
          hint={`${followUpsSkipped} dispensado(s) pelas regras (horário, limite, resposta do contato…)`}
        />
      </dl>
      <div className="grid gap-3 lg:grid-cols-2">
        <Panel className="p-5">
          <h3 className="text-sm font-semibold text-foreground">Ferramentas do CRM usadas pela IA</h3>
          {usage.tools.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">Nenhum uso no período.</p>
          ) : (
            <ul className="mt-3 space-y-1.5 text-sm">
              {usage.tools.map((item) => (
                <li key={item.tool} className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">{TOOL_LABELS[item.tool] ?? item.tool}</span>
                  <span className="text-foreground tabular-nums">{item.uses}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel className="p-5">
          <h3 className="text-sm font-semibold text-foreground">Falhas por tipo</h3>
          {usage.errors.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">Nenhuma falha no período.</p>
          ) : (
            <ul className="mt-3 space-y-1.5 text-sm">
              {usage.errors.map((item) => (
                <li key={item.code} className="flex items-center justify-between gap-3">
                  <code className="text-xs text-muted-foreground">{item.code}</code>
                  <span className="text-foreground tabular-nums">{item.count}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            Detalhes de cada execução em <Link href="/assistente?aba=registros" className="underline underline-offset-4">Registros</Link>.
          </p>
        </Panel>
      </div>
      <p className="text-xs text-muted-foreground">
        Custo estimado com os preços configurados no servidor (AI_PRICE_*); a fatura do provedor é a referência oficial.
      </p>
    </section>
  );
}

async function OverviewTab({ filters }: { filters: AssistantFilters }) {
  const period = Number(filters.periodo);
  const [overview, engine] = [await getAssistantOverview(period), getAssistantEngineStatus()];
  const whatsapp = getWhatsAppIntegrationStatus();

  return (
    <div className="space-y-6">
      <Panel className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start sm:justify-between sm:p-6">
        <div className="flex items-start gap-3">
          <Bot aria-hidden className="mt-0.5 size-5 shrink-0 text-insight" />
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">
              {engine.title}
              {engine.model ? <span className="ml-2 text-xs font-normal text-muted-foreground">{engine.model}</span> : null}
            </p>
            <p className="max-w-[70ch] text-sm text-muted-foreground">{engine.description}</p>
            <p className="text-xs text-muted-foreground">WhatsApp: {whatsapp.title}</p>
          </div>
        </div>
        <SegmentedFilter
          param="periodo"
          label="Período das métricas"
          defaultValue="30"
          options={[
            { value: "7", label: "7 dias" },
            { value: "30", label: "30 dias" },
            { value: "90", label: "90 dias" },
          ]}
        />
      </Panel>

      <section aria-labelledby="metrics-attendance" className="space-y-3">
        <h2 id="metrics-attendance" className="text-sm font-semibold text-foreground">
          Atendimento
        </h2>
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Tile label="Conversas iniciadas" value={overview.conversationsStarted} hint={`${overview.inboundMessages} mensagens recebidas`} />
          <Tile label="Respostas do assistente" value={overview.assistantReplies} />
          <Tile label="Tempo de resposta (mediana)" value={formatSeconds(overview.responseTimes.assistant)} hint={`Equipe: ${formatSeconds(overview.responseTimes.team)}`} />
          <Tile
            label="Encaminhadas para a equipe"
            value={overview.handoffs}
            hint={`${overview.noAnswers} sem resposta aprovada · ${overview.openTasks} tarefa(s) aberta(s)`}
            href="/tarefas"
          />
        </dl>
      </section>

      <section aria-labelledby="metrics-leads" className="space-y-3">
        <h2 id="metrics-leads" className="text-sm font-semibold text-foreground">
          Captação e agenda
        </h2>
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Tile label="Leads captados pelo assistente" value={overview.leadsCaptured} href="/leads?origem=WHATSAPP" />
          <Tile label="Qualificados" value={overview.qualified} hint={`${percent(overview.qualified, overview.leadsCaptured)} dos captados`} />
          <Tile label="Convertidos em pacientes" value={overview.converted} hint={`${percent(overview.converted, overview.leadsCaptured)} dos captados`} />
          <Tile label="Agendamentos feitos pelo assistente" value={overview.bookings} hint={`${overview.reschedules} remarcação(ões)`} />
        </dl>
      </section>

      {engine.provider === "anthropic" ? <AiUsageSection periodDays={overview.periodDays} /> : null}

      <section aria-labelledby="metrics-returns" className="space-y-3">
        <h2 id="metrics-returns" className="text-sm font-semibold text-foreground">
          Retornos e consentimento
        </h2>
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Tile label="Mensagens de acompanhamento" value={overview.followUpMessages} hint={`${overview.followUpTasks} tarefa(s) de contato manual`} />
          <Tile label="Retornos agendados após acompanhamento" value={overview.returnsScheduled} href="/protocolos" />
          <Tile label="Descadastros" value={overview.optOuts} href="/assistente?aba=consentimentos" />
          <Tile label="Perguntas sem resposta abertas" value={overview.openGaps} href="/assistente?aba=pendencias" />
        </dl>
      </section>
      <p className="text-xs text-muted-foreground">
        Tempo de resposta: mediana entre a primeira mensagem do contato e a resposta seguinte, nos últimos {overview.periodDays} dias.
        Leads e agendamentos do assistente são contados pela trilha de auditoria.
      </p>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Base de conhecimento
// -----------------------------------------------------------------------------

async function KnowledgeTab({ filters, user }: { filters: AssistantFilters; user: SessionUser }) {
  const [{ total, entries, pendingReview }, procedures] = await Promise.all([listKnowledgeEntries(filters), getActiveProcedureOptions()]);
  const procedureOptions = procedures.map((item) => ({ value: item.id, label: item.name }));
  const canWrite = hasPermission(user.role, "knowledge:write");
  const canApprove = hasPermission(user.role, "knowledge:approve");
  const timeZone = getServerEnv().APP_TIMEZONE;

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-center gap-2.5">
          <SearchFilter placeholder="Buscar pergunta ou resposta" label="Buscar na base de conhecimento" className="w-full sm:w-72" />
          <SelectFilter
            param="categoria"
            label="Categoria"
            allLabel="Todas as categorias"
            options={(Object.keys(KNOWLEDGE_CATEGORY_LABELS) as KnowledgeCategory[]).map((value) => ({ value, label: KNOWLEDGE_CATEGORY_LABELS[value] }))}
          />
          {canWrite ? (
            <div className="sm:ml-auto">
              <KnowledgeEntryDialog
                procedures={procedureOptions}
                trigger={
                  <Button>
                    <Plus aria-hidden />
                    Nova resposta
                  </Button>
                }
              />
            </div>
          ) : null}
        </div>
        <SegmentedFilter
          param="situacao"
          label="Situação"
          defaultValue=""
          options={[
            { value: "", label: "Todas" },
            { value: "publicadas", label: "Publicadas" },
            { value: "revisao", label: `Aguardando aprovação (${pendingReview})` },
            { value: "rascunhos", label: "Rascunhos" },
            { value: "arquivadas", label: "Arquivadas" },
          ]}
        />
        <Panel aria-label="Entradas da base de conhecimento" className="overflow-hidden">
          {entries.length === 0 ? (
            <EmptyState
              title="Nenhuma resposta aqui"
              description="Cadastre serviços, preços autorizados, horários, endereço, políticas e perguntas frequentes. O assistente só usa o que for aprovado."
            />
          ) : (
            <>
              <ul className="divide-y divide-border">
                {entries.map((entry) => {
                  const latest = entry.versions[0];
                  const published = entry.publishedVersion;
                  const shown = latest ?? published;
                  if (!shown) return null;
                  const pendingNew = latest && published && latest.id !== published.id && (latest.status === "DRAFT" || latest.status === "IN_REVIEW");
                  return (
                    <li key={entry.id} className="space-y-2 px-5 py-4 sm:px-6">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-medium text-foreground">{shown.title}</p>
                          <p className="text-xs text-muted-foreground">
                            {KNOWLEDGE_CATEGORY_LABELS[entry.category]}
                            {entry.procedure ? ` · ${entry.procedure.name}` : ""}
                            {latest ? ` · v${latest.version} por ${latest.author.name} em ${formatShortDateTime(latest.createdAt, timeZone)}` : ""}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {entry.isArchived ? <StatusBadge tone="muted" label="Arquivada" /> : null}
                          {published && !entry.isArchived ? <StatusBadge tone="success" label={`Publicada (v${published.version})`} /> : null}
                          {latest && (!published || pendingNew) ? (
                            <StatusBadge tone={KNOWLEDGE_VERSION_STATUS_TONES[latest.status]} label={`${KNOWLEDGE_VERSION_STATUS_LABELS[latest.status]} (v${latest.version})`} />
                          ) : null}
                        </div>
                      </div>
                      <p className="line-clamp-3 whitespace-pre-line text-sm text-foreground/85">{(published ?? shown).content}</p>
                      <div className="flex flex-wrap gap-1">
                        <KnowledgeHistoryDialog entryId={entry.id} title={shown.title} canApprove={canApprove} canWrite={canWrite} />
                        {canWrite && !entry.isArchived ? (
                          <KnowledgeEntryDialog
                            procedures={procedureOptions}
                            entry={{
                              id: entry.id,
                              category: entry.category,
                              procedureId: entry.procedure?.id ?? null,
                              title: shown.title,
                              content: shown.content,
                              keywords: shown.keywords,
                            }}
                            trigger={
                              <Button variant="ghost" size="sm">
                                Editar
                              </Button>
                            }
                          />
                        ) : null}
                        {canApprove ? <ArchiveEntryButton entryId={entry.id} archived={entry.isArchived} title={shown.title} /> : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
              <Pagination
                page={filters.pagina}
                pageSize={ASSISTANT_PAGE_SIZE}
                total={total}
                basePath="/assistente"
                params={{ aba: "conhecimento", categoria: filters.categoria, situacao: filters.situacao, busca: filters.busca }}
              />
            </>
          )}
        </Panel>
      </div>
      <aside className="space-y-3">
        <Panel className="p-5">
          <h2 className="mb-1 text-sm font-semibold text-foreground">Testar antes de publicar</h2>
          <p className="mb-4 text-xs text-muted-foreground">
            Mesmo motor e mesma checagem de segurança do atendimento, sem enviar mensagem. Use para conferir respostas novas.
          </p>
          {canWrite ? <KnowledgeTestPanel /> : <p className="text-sm text-muted-foreground">Seu perfil só consulta a base.</p>}
        </Panel>
      </aside>
    </div>
  );
}

async function GapsTab({ filters, user }: { filters: AssistantFilters; user: SessionUser }) {
  const [{ total, gaps }, procedures] = await Promise.all([listKnowledgeGaps(filters.pagina), getActiveProcedureOptions()]);
  const procedureOptions = procedures.map((item) => ({ value: item.id, label: item.name }));
  const canWrite = hasPermission(user.role, "knowledge:write");
  const timeZone = getServerEnv().APP_TIMEZONE;

  return (
    <div className="space-y-4">
      <p className="max-w-[75ch] text-sm text-muted-foreground">
        Perguntas que o assistente não soube responder com a base aprovada e respostas avaliadas negativamente pela equipe. As
        perguntas são guardadas sem telefones, e-mails ou CPF. Escreva a resposta correta: ela passa pela aprovação antes de
        ser usada, e a pendência é resolvida ao publicar.
      </p>
      <Panel aria-label="Perguntas sem resposta" className="overflow-hidden">
        {gaps.length === 0 ? (
          <EmptyState title="Nenhuma pendência" description="Quando o assistente não encontrar uma resposta aprovada, a pergunta aparece aqui." />
        ) : (
          <>
            <ul className="divide-y divide-border">
              {gaps.map((gap) => (
                <li key={gap.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-6">
                  <div className="min-w-0 space-y-1">
                    <p className="text-sm text-foreground">“{gap.question}”</p>
                    <p className="text-xs text-muted-foreground">
                      {KNOWLEDGE_GAP_REASON_LABELS[gap.reason]} · {formatShortDateTime(gap.createdAt, timeZone)}
                      {gap.reportedBy ? ` · avaliada por ${gap.reportedBy.name}` : ""}
                      {gap.conversationId ? (
                        <>
                          {" · "}
                          <Link href={`/whatsapp?conversa=${gap.conversationId}`} className="text-primary underline-offset-4 hover:underline">
                            ver conversa
                          </Link>
                        </>
                      ) : null}
                    </p>
                    {gap.feedbackNote ? <p className="text-xs text-foreground/80">Comentário: {gap.feedbackNote}</p> : null}
                    {gap.resolvedEntryId ? <StatusBadge tone="warning" label="Resposta criada — aguardando aprovação" /> : null}
                  </div>
                  {canWrite ? (
                    <div className="flex shrink-0 gap-1">
                      <KnowledgeEntryDialog
                        procedures={procedureOptions}
                        gap={{ id: gap.id, question: gap.question }}
                        trigger={<Button size="sm">Responder</Button>}
                      />
                      <DismissGapButton gapId={gap.id} />
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
            <Pagination page={filters.pagina} pageSize={ASSISTANT_PAGE_SIZE} total={total} basePath="/assistente" params={{ aba: "pendencias" }} />
          </>
        )}
      </Panel>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Configurações, modelos, consentimentos e registros
// -----------------------------------------------------------------------------

async function SettingsTab({ user }: { user: SessionUser }) {
  const db = getDb();
  const [config, meta, procedures, professionals] = await Promise.all([
    getAssistantConfig(db),
    getAssistantSettingsMeta(db),
    getActiveProcedureOptions(),
    getProfessionalOptions(),
  ]);
  const timeZone = getServerEnv().APP_TIMEZONE;
  return (
    <div className="space-y-4">
      {meta ? (
        <p className="text-xs text-muted-foreground">
          Última alteração em {formatShortDateTime(meta.updatedAt, timeZone)}
          {meta.updatedBy ? ` por ${meta.updatedBy.name}` : ""}.
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">Usando a configuração padrão (ainda não salva).</p>
      )}
      <AssistantSettingsForm
        initial={config}
        procedures={procedures.map((item) => ({ value: item.id, label: `${item.name} (${item.durationMinutes} min)` }))}
        professionals={professionals.map((item) => ({ value: item.id, label: item.name }))}
        readOnly={!hasPermission(user.role, "assistant:configure")}
        engine={settingsEngineOf(getServerEnv())}
      />
    </div>
  );
}

function settingsEngineOf(env: ReturnType<typeof getServerEnv>): "agent" | "guided" | "rules" | "disabled" {
  if (env.AI_PROVIDER === "anthropic") return env.AI_ENGINE;
  return env.AI_PROVIDER;
}

async function TemplatesTab({ user }: { user: SessionUser }) {
  const templates = await listMessageTemplates();
  const canConfigure = hasPermission(user.role, "assistant:configure");
  const env = getServerEnv();
  const canSync = canConfigure && env.WHATSAPP_PROVIDER === "cloud_api" && Boolean(env.WHATSAPP_BUSINESS_ACCOUNT_ID);
  const timeZone = env.APP_TIMEZONE;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-[70ch] text-sm text-muted-foreground">
          Fora da janela de 24 horas, só modelos aprovados pela Meta podem ser enviados. Crie o modelo no WhatsApp Manager,
          cadastre-o aqui com o mesmo nome e registre a aprovação (ou sincronize).
        </p>
        <div className="flex gap-2">
          {canSync ? <SyncTemplatesButton /> : null}
          {canConfigure ? (
            <TemplateFormDialog
              trigger={
                <Button>
                  <Plus aria-hidden />
                  Novo modelo
                </Button>
              }
            />
          ) : null}
        </div>
      </div>
      {templates.length === 0 ? (
        <Panel>
          <EmptyState title="Nenhum modelo cadastrado" description="Sem modelo aprovado, lembretes e acompanhamentos não são enviados pelo WhatsApp." />
        </Panel>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {templates.map((template) => (
            <Panel key={template.id} className="flex flex-col gap-3 p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-medium text-foreground">{template.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {TEMPLATE_USAGE_LABELS[template.usage]} · {TEMPLATE_CATEGORY_LABELS[template.category]} · {template.language}
                  </p>
                </div>
                <StatusBadge tone={TEMPLATE_STATUS_TONES[template.status]} label={TEMPLATE_STATUS_LABELS[template.status]} />
              </div>
              <p className="whitespace-pre-line rounded-lg bg-muted/40 px-3 py-2 text-sm text-foreground/85">{template.body}</p>
              {template.parameters.length > 0 ? (
                <p className="text-xs text-muted-foreground">
                  Parâmetros:{" "}
                  {template.parameters
                    .map((parameter, index) => `{{${index + 1}}} ${TEMPLATE_PARAMETER_LABELS[parameter as TemplateParameter] ?? parameter}`)
                    .join(" · ")}
                </p>
              ) : null}
              <p className="text-xs text-muted-foreground">
                {template.statusUpdatedAt
                  ? `Situação ${template.statusSource === "meta" ? "informada pela Meta" : "registrada manualmente"} em ${formatShortDateTime(template.statusUpdatedAt, timeZone)}`
                  : "Situação ainda não registrada"}
                {template.rejectionReason ? ` — motivo: ${template.rejectionReason}` : ""}
                {template._count.followUpRules > 0 ? ` · usado em ${template._count.followUpRules} regra(s) de acompanhamento` : ""}
              </p>
              {canConfigure ? (
                <div className="mt-auto flex gap-1">
                  <TemplateFormDialog
                    template={{
                      id: template.id,
                      name: template.name,
                      language: template.language,
                      category: template.category,
                      usage: template.usage,
                      body: template.body,
                      parameters: template.parameters,
                    }}
                    trigger={
                      <Button variant="ghost" size="sm">
                        Editar
                      </Button>
                    }
                  />
                  <TemplateStatusDialog templateId={template.id} status={template.status} name={template.name} />
                </div>
              ) : null}
            </Panel>
          ))}
        </div>
      )}
    </div>
  );
}

async function ConsentsTab({ page }: { page: number }) {
  const { optedOut, total, events } = await getConsentOverview(page);
  const timeZone = getServerEnv().APP_TIMEZONE;
  return (
    <div className="grid gap-6 lg:grid-cols-[22rem_minmax(0,1fr)]">
      <Panel aria-label="Números descadastrados" className="overflow-hidden">
        <h2 className="border-b border-border px-5 py-3 text-sm font-semibold text-foreground">Descadastrados ({optedOut.length})</h2>
        {optedOut.length === 0 ? (
          <p className="px-5 py-4 text-sm text-muted-foreground">Nenhum descadastro.</p>
        ) : (
          <ul className="divide-y divide-border">
            {optedOut.map((item) => (
              <li key={item.id} className="px-5 py-3">
                <Link href={`/whatsapp?conversa=${item.id}`} className="text-sm text-foreground hover:underline hover:underline-offset-4">
                  {item.patient?.fullName ?? item.lead?.name ?? item.contactName ?? formatPhone(item.contactPhone)}
                </Link>
                <p className="text-xs text-muted-foreground tabular-nums">
                  {formatPhone(item.contactPhone)} · desde {formatShortDateTime(item.optedOutAt!, timeZone)}
                </p>
              </li>
            ))}
          </ul>
        )}
        <p className="border-t border-border px-5 py-3 text-xs text-muted-foreground">
          Para esses números nada é enviado de forma automática. Responder quando o contato escreve continua permitido.
        </p>
      </Panel>
      <Panel aria-label="Histórico de consentimentos" className="overflow-hidden">
        <h2 className="border-b border-border px-5 py-3 text-sm font-semibold text-foreground">Histórico (prova de consentimento)</h2>
        {events.length === 0 ? (
          <p className="px-5 py-4 text-sm text-muted-foreground">Nenhum registro ainda.</p>
        ) : (
          <>
            <ul className="divide-y divide-border">
              {events.map((event) => (
                <li key={event.id} className="flex flex-col gap-1 px-5 py-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm text-foreground">
                      {event.patient?.fullName ?? event.lead?.name ?? formatPhone(event.phone)} — {CONSENT_PURPOSE_LABELS[event.purpose]}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {CONSENT_SOURCE_LABELS[event.source]}
                      {event.actor ? ` · ${event.actor.name}` : ""}
                      {event.evidence ? ` · ${event.evidence}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <StatusBadge tone={event.granted ? "success" : "danger"} label={event.granted ? "Autorizou" : "Revogou"} />
                    <time className="text-xs text-muted-foreground tabular-nums">{formatShortDateTime(event.createdAt, timeZone)}</time>
                  </div>
                </li>
              ))}
            </ul>
            <Pagination page={page} pageSize={ASSISTANT_PAGE_SIZE} total={total} basePath="/assistente" params={{ aba: "consentimentos" }} />
          </>
        )}
      </Panel>
    </div>
  );
}

async function LogsTab() {
  const logs = await getAutomationLogs();
  const timeZone = getServerEnv().APP_TIMEZONE;
  return (
    <div className="space-y-6">
      <dl className="grid gap-3 sm:grid-cols-3">
        <Tile label="Mensagens aguardando o assistente" value={logs.pendingRuns} />
        <Tile label="Reenvios agendados" value={logs.pendingRetries} />
        <Tile label="Lembretes vencidos na fila" value={logs.dueReminders} hint="Processados pelo agendador (/api/jobs/automation)" />
      </dl>

      <Panel aria-label="Execuções do assistente" className="overflow-hidden">
        <h2 className="border-b border-border px-5 py-3 text-sm font-semibold text-foreground">Execuções recentes do assistente</h2>
        {logs.runs.length === 0 ? (
          <p className="px-5 py-4 text-sm text-muted-foreground">Nenhuma execução ainda.</p>
        ) : (
          <ul className="divide-y divide-border">
            {logs.runs.map((run) => {
              const contact = run.conversation.patient?.fullName ?? run.conversation.lead?.name ?? run.conversation.contactName ?? formatPhone(run.conversation.contactPhone);
              return (
                <li key={run.id} className="flex flex-col gap-1 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <Link href={`/whatsapp?conversa=${run.conversation.id}`} className="text-sm text-foreground hover:underline hover:underline-offset-4">
                      {contact}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {formatShortDateTime(run.createdAt, timeZone)} · {run.engine ?? "—"}
                      {run.intent ? ` · intenção: ${run.intent}` : ""}
                      {run.latencyMs !== null ? ` · ${(run.latencyMs / 1000).toFixed(1).replace(".", ",")} s` : ""}
                      {run.attempts > 1 ? ` · ${run.attempts} tentativas` : ""}
                      {run.kind === "FOLLOW_UP" ? " · acompanhamento" : ""}
                      {run.modelCalls > 0 ? ` · ${run.modelCalls} chamada(s) · ${formatUsd(run.costMicros)}` : ""}
                      {run.flags.length ? ` · ${run.flags.join(", ")}` : ""}
                    </p>
                    {run.toolCalls.length ? (
                      <p className="text-xs text-muted-foreground">
                        Ferramentas: {run.toolCalls.map((tool) => TOOL_LABELS[tool] ?? tool).join(" → ")}
                      </p>
                    ) : null}
                    {run.errorMessage ? <p className="text-xs text-destructive">{run.errorMessage}</p> : null}
                  </div>
                  {run.outcome ? (
                    <StatusBadge tone={ASSISTANT_OUTCOME_TONES[run.outcome]} label={ASSISTANT_OUTCOME_LABELS[run.outcome]} />
                  ) : (
                    <StatusBadge tone="muted" label={run.status === "PENDING" ? "Na fila" : run.status === "PROCESSING" ? "Processando" : run.status} />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <div className="grid gap-6 lg:grid-cols-3">
        <Panel aria-label="Mensagens com falha" className="overflow-hidden">
          <h2 className="border-b border-border px-5 py-3 text-sm font-semibold text-foreground">Mensagens com falha</h2>
          {logs.failedMessages.length === 0 ? (
            <p className="px-5 py-4 text-sm text-muted-foreground">Nenhuma falha.</p>
          ) : (
            <ul className="divide-y divide-border">
              {logs.failedMessages.map((message) => (
                <li key={message.id} className="px-5 py-3">
                  <Link href={`/whatsapp?conversa=${message.conversation.id}`} className="text-sm text-foreground hover:underline hover:underline-offset-4">
                    {formatPhone(message.conversation.contactPhone)}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {MESSAGE_ORIGIN_LABELS[message.origin]} · {formatShortDateTime(message.createdAt, timeZone)} · {message.attempts} tentativa(s)
                  </p>
                  <p className="text-xs text-destructive">{message.errorMessage ?? message.errorCode}</p>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel aria-label="Lembretes com falha" className="overflow-hidden">
          <h2 className="border-b border-border px-5 py-3 text-sm font-semibold text-foreground">Lembretes com falha</h2>
          {logs.failedReminders.length === 0 ? (
            <p className="px-5 py-4 text-sm text-muted-foreground">Nenhuma falha.</p>
          ) : (
            <ul className="divide-y divide-border">
              {logs.failedReminders.map((reminder) => (
                <li key={reminder.id} className="px-5 py-3">
                  <p className="text-sm text-foreground">{reminder.patient?.fullName ?? reminder.lead?.name ?? "Contato"}</p>
                  <p className="text-xs text-muted-foreground">
                    {REMINDER_KIND_LABELS[reminder.kind]} · {formatShortDateTime(reminder.updatedAt, timeZone)} · {reminder.attempts} tentativa(s)
                  </p>
                  <p className="text-xs text-destructive">{reminder.lastError}</p>
                </li>
              ))}
            </ul>
          )}
          <p className="border-t border-border px-5 py-3 text-xs">
            <Link href="/protocolos?aba=lembretes&lembrete=FAILED" className="text-primary underline-offset-4 hover:underline">
              Reenviar ou cancelar na fila de lembretes
            </Link>
          </p>
        </Panel>
        <Panel aria-label="Webhooks com erro" className="overflow-hidden">
          <h2 className="border-b border-border px-5 py-3 text-sm font-semibold text-foreground">Webhooks com erro</h2>
          {logs.webhookErrors.length === 0 ? (
            <p className="px-5 py-4 text-sm text-muted-foreground">Nenhum erro.</p>
          ) : (
            <ul className="divide-y divide-border">
              {logs.webhookErrors.map((event) => (
                <li key={event.id} className="px-5 py-3">
                  <p className="text-sm text-foreground">
                    {event.kind} · {formatShortDateTime(event.receivedAt, timeZone)}
                  </p>
                  <p className="text-xs text-muted-foreground">{event.processedAt ? "Reprocessado com sucesso" : "Aguardando reentrega da Meta"}</p>
                  <p className="text-xs text-destructive">{event.errorMessage}</p>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
      <p className="text-xs text-muted-foreground">
        Os registros não guardam conteúdo de mensagens, tokens nem dados pessoais nos erros. Detalhes técnicos ficam nos logs
        estruturados do servidor (também com redação de dados pessoais).
      </p>
    </div>
  );
}
