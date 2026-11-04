import { ArrowLeft, Bot, FlaskConical, Hand, ShieldAlert, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { EmptyState } from "@/components/data/empty-state";
import { TableSkeleton } from "@/components/data/table-skeleton";
import { SearchFilter, SegmentedFilter } from "@/components/data/url-filters";
import { AccessDenied } from "@/components/layout/access-denied";
import { PageContainer, PageHeader, Panel } from "@/components/layout/page";
import { StatusBadge } from "@/components/ui-kit/status-badge";
import {
  ConversationModeToggle,
  EraseConversationButton,
  MarkConversationRead,
  MessageComposer,
  NewConversationButton,
  RefreshButton,
  ReportReplyButton,
  SimulateInbound,
} from "@/components/whatsapp/conversation-controls";
import { hasPermission } from "@/lib/auth/permissions";
import { formatShortDateTime } from "@/lib/format";
import { ASSISTANT_OUTCOME_LABELS, MESSAGE_ORIGIN_LABELS, MESSAGE_STATUS_LABELS, TASK_KIND_LABELS } from "@/lib/labels";
import { formatPhone } from "@/lib/phone";
import { cn } from "@/lib/utils";
import { inboxFiltersSchema } from "@/lib/validation/assistant";
import { getAssistantEngineStatus, type AssistantEngineStatus } from "@/server/assistant/runtime";
import { checkPermission } from "@/server/auth/dal";
import type { SessionUser } from "@/server/auth/session-store";
import { getServerEnv } from "@/server/env";
import { NotFoundError } from "@/server/errors";
import { getConversationDetail, listConversations, type ConversationListItem } from "@/server/queries/whatsapp";
import { isWithinServiceWindow, SERVICE_WINDOW_MS } from "@/server/services/whatsapp";
import { getWhatsAppIntegrationStatus, type WhatsAppIntegrationStatus } from "@/server/whatsapp/provider";

export const metadata: Metadata = { title: "WhatsApp" };

type SearchParams = PageProps<"/whatsapp">["searchParams"];

export default function WhatsAppPage(props: PageProps<"/whatsapp">) {
  return (
    <PageContainer className="max-w-7xl">
      <PageHeader
        title="WhatsApp"
        description="Caixa de entrada do atendimento: o assistente virtual responde com informações aprovadas e encaminha para a equipe quando necessário. Tudo fica registrado no histórico de cada contato."
      />
      <Suspense fallback={<TableSkeleton rows={6} />}>
        <WhatsAppContent searchParams={props.searchParams} />
      </Suspense>
    </PageContainer>
  );
}

function IntegrationBanner({ status, engine }: { status: WhatsAppIntegrationStatus; engine: AssistantEngineStatus }) {
  const Icon = status.provider === "cloud_api" ? ShieldCheck : status.provider === "development" ? FlaskConical : ShieldAlert;
  const iconColor =
    status.provider === "cloud_api" ? "text-success" : status.provider === "development" ? "text-info" : "text-warning";
  return (
    <Panel
      role="status"
      className={cn(
        "mb-6 flex flex-col gap-4 p-5 sm:flex-row sm:items-start sm:justify-between",
        status.provider === "development" && "border-info/35 bg-info/[0.04]",
        status.provider === "disabled" && "border-warning/35",
      )}
    >
      <div className="flex min-w-0 items-start gap-4">
        <Icon aria-hidden className={cn("mt-0.5 size-5 shrink-0", iconColor)} />
        <div className="min-w-0 space-y-1">
          <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
            {status.title}
            {status.provider === "development" ? <StatusBadge tone="info" label="Nada é enviado aos contatos" /> : null}
          </p>
          <p className="text-sm text-muted-foreground">{status.description}</p>
          {status.provider !== "development" ? (
            <p className="text-xs text-muted-foreground">Webhook {status.webhookConfigured ? "configurado" : "não configurado"}</p>
          ) : null}
        </div>
      </div>
      <div className="flex min-w-0 items-start gap-3 sm:max-w-sm">
        <Bot aria-hidden className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">{engine.title}</p>
          <p className="text-xs text-muted-foreground">{engine.description}</p>
          <Link href="/assistente" className="text-xs text-primary underline-offset-4 hover:underline">
            Base de conhecimento e configurações
          </Link>
        </div>
      </div>
    </Panel>
  );
}

async function WhatsAppContent({ searchParams }: { searchParams: SearchParams }) {
  const { user, allowed } = await checkPermission("whatsapp:read");
  if (!allowed) return <AccessDenied resource="as conversas do WhatsApp" />;

  const filters = inboxFiltersSchema.parse(await searchParams);
  const search = filters.busca || undefined;
  const selected = filters.conversa;
  const status = getWhatsAppIntegrationStatus();
  const engine = getAssistantEngineStatus();
  const { items, counts } = await listConversations(search, filters.filtro);
  const query = (extra: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    if (filters.filtro !== "todas") params.set("filtro", filters.filtro);
    if (search) params.set("busca", search);
    for (const [key, value] of Object.entries(extra)) if (value) params.set(key, value);
    const text = params.toString();
    return text ? `/whatsapp?${text}` : "/whatsapp";
  };

  return (
    <>
      <IntegrationBanner status={status} engine={engine} />
      <div className="grid gap-6 lg:grid-cols-[23rem_minmax(0,1fr)]">
        <div className={cn("min-w-0 space-y-3", selected && "hidden lg:block")}>
          <div className="flex items-center gap-2">
            <SearchFilter placeholder="Buscar conversa" label="Buscar conversas" className="flex-1" />
            {hasPermission(user.role, "whatsapp:send") ? <NewConversationButton /> : null}
          </div>
          <div className="overflow-x-auto">
            <SegmentedFilter
              param="filtro"
              label="Filtrar conversas"
              defaultValue="todas"
              options={[
                { value: "todas", label: "Todas" },
                { value: "equipe", label: `Equipe (${counts.human})` },
                { value: "assistente", label: "Assistente" },
                { value: "nao-lidas", label: `Não lidas (${counts.unread})` },
                { value: "descadastrados", label: "Descadastrados" },
              ]}
            />
          </div>
          {counts.waiting > 0 ? (
            <p className="flex items-center gap-1.5 text-xs text-primary">
              <Hand aria-hidden className="size-3.5" />
              {counts.waiting} conversa(s) aguardando a equipe —{" "}
              <Link href="/tarefas" className="underline-offset-4 hover:underline">
                ver tarefas
              </Link>
            </p>
          ) : null}
          <ConversationList items={items} selectedId={selected} hrefFor={(id) => query({ conversa: id })} search={search} />
        </div>
        <div className={cn("min-w-0", !selected && "hidden lg:block")}>
          {selected ? (
            <Suspense key={selected} fallback={<TableSkeleton rows={5} />}>
              <ConversationPanel id={selected} user={user} status={status} backHref={query({})} />
            </Suspense>
          ) : (
            <Panel>
              <EmptyState
                title="Selecione uma conversa"
                description="As conversas também podem ser abertas pela ficha do paciente ou do lead (botão “Conversa”)."
              />
            </Panel>
          )}
        </div>
      </div>
    </>
  );
}

function ConversationList({
  items,
  selectedId,
  hrefFor,
  search,
}: {
  items: ConversationListItem[];
  selectedId?: string;
  hrefFor: (id: string) => string;
  search?: string;
}) {
  const timeZone = getServerEnv().APP_TIMEZONE;
  if (items.length === 0) {
    return (
      <Panel>
        <EmptyState
          title={search ? "Nenhuma conversa encontrada" : "Nenhuma conversa aqui"}
          description="Conversas aparecem quando um contato escreve para a clínica ou quando a equipe inicia uma conversa."
        />
      </Panel>
    );
  }

  return (
    <Panel aria-label="Conversas" className="overflow-hidden">
      <ul className="divide-y divide-border">
        {items.map((item) => {
          const last = item.messages[0];
          const name = item.patient?.fullName ?? item.lead?.name ?? item.contactName ?? formatPhone(item.contactPhone);
          const lastPrefix =
            last?.direction === "OUTBOUND" ? (last.origin === "STAFF" ? "Equipe: " : last.origin === "ASSISTANT" ? "Assistente: " : "Automático: ") : "";
          return (
            <li key={item.id}>
              <Link
                href={hrefFor(item.id)}
                aria-current={item.id === selectedId ? "true" : undefined}
                className={cn(
                  "flex items-start gap-3 px-4 py-3.5 transition-colors hover:bg-muted/40",
                  item.id === selectedId && "bg-accent/60",
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="truncate text-sm font-medium text-foreground">{name}</p>
                    {item.lastMessageAt ? (
                      <time className="shrink-0 text-[0.6875rem] text-muted-foreground tabular-nums" dateTime={item.lastMessageAt.toISOString()}>
                        {formatShortDateTime(item.lastMessageAt, timeZone)}
                      </time>
                    ) : null}
                  </div>
                  <p className="flex flex-wrap items-center gap-x-1.5 truncate text-xs text-muted-foreground">
                    {item.patient ? "Paciente" : item.lead ? "Lead" : "Contato"} · {formatPhone(item.contactPhone)}
                    <span aria-hidden>·</span>
                    <span className={item.mode === "HUMAN" ? "text-foreground/80" : undefined}>
                      {item.mode === "HUMAN" ? "Equipe" : "Assistente"}
                    </span>
                    {item.optedOutAt ? <span className="text-destructive">· descadastrado</span> : null}
                  </p>
                  {last ? (
                    <p className="mt-0.5 truncate text-[0.8125rem] text-foreground/75">
                      {lastPrefix}
                      {last.body ?? (last.type === "TEMPLATE" ? "Modelo enviado" : "Mensagem apagada")}
                    </p>
                  ) : null}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  {item.unreadCount > 0 ? (
                    <span
                      className="mt-0.5 flex min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[0.6875rem] font-medium text-primary-foreground tabular-nums"
                      aria-label={`${item.unreadCount} não lida(s)`}
                    >
                      {item.unreadCount}
                    </span>
                  ) : null}
                  {item.awaitingTeam ? <Hand aria-label="Aguardando a equipe" className="size-3.5 text-primary" /> : null}
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

async function loadConversation(id: string) {
  try {
    return await getConversationDetail(id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}

async function ConversationPanel({
  id,
  user,
  status,
  backHref,
}: {
  id: string;
  user: SessionUser;
  status: WhatsAppIntegrationStatus;
  backHref: string;
}) {
  const conversation = await loadConversation(id);
  const timeZone = getServerEnv().APP_TIMEZONE;
  const now = new Date();
  const name = conversation.patient?.fullName ?? conversation.lead?.name ?? conversation.contactName ?? formatPhone(conversation.contactPhone);
  const windowOpen = isWithinServiceWindow(conversation.lastInboundAt, now);
  const canSend = hasPermission(user.role, "whatsapp:send");
  const canReport = hasPermission(user.role, "knowledge:write");
  const optIn = conversation.patient?.whatsappOptIn ?? conversation.lead?.whatsappOptIn ?? false;

  const disabledReason = !canSend
    ? "Seu perfil pode ler, mas não enviar mensagens."
    : !status.canSend
      ? "A integração com o WhatsApp está desativada: nenhuma mensagem pode ser enviada. Configure a API oficial (veja a documentação)."
      : !windowOpen
        ? status.provider === "development"
          ? "Fora da janela de 24 horas. No modo de desenvolvimento, simule uma mensagem do contato abaixo para abrir a janela."
          : "Fora da janela de 24 horas: o WhatsApp só permite mensagens livres até 24h depois da última mensagem do contato. Fora dela, apenas modelos aprovados (como os lembretes)."
        : null;

  return (
    <Panel aria-label={`Conversa com ${name}`} className="flex min-h-[32rem] flex-col">
      <MarkConversationRead conversationId={conversation.id} unread={conversation.unreadCount} />
      <header className="space-y-3 border-b border-border px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <Link href={backHref} className="mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground lg:hidden">
              <ArrowLeft aria-hidden className="size-3.5" />
              Conversas
            </Link>
            <h2 className="truncate text-title-3 text-foreground">{name}</h2>
            <p className="text-xs text-muted-foreground tabular-nums">
              {formatPhone(conversation.contactPhone)}
              {conversation.patient ? (
                <>
                  {" · "}
                  <Link href={`/pacientes/${conversation.patient.id}`} className="text-primary underline-offset-4 hover:underline">
                    ficha do paciente
                  </Link>
                </>
              ) : conversation.lead ? (
                <>
                  {" · "}
                  <Link href={`/leads/${conversation.lead.id}`} className="text-primary underline-offset-4 hover:underline">
                    lead
                  </Link>
                </>
              ) : (
                " · contato sem cadastro"
              )}
              {" · "}
              {conversation.optedOutAt
                ? "descadastrado: sem mensagens automáticas"
                : optIn
                  ? "autorizou lembretes e avisos"
                  : "sem autorização para mensagens automáticas"}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge
              tone={windowOpen ? "success" : "muted"}
              label={
                windowOpen && conversation.lastInboundAt
                  ? `Janela aberta até ${formatShortDateTime(new Date(conversation.lastInboundAt.getTime() + SERVICE_WINDOW_MS), timeZone)}`
                  : "Fora da janela de 24h"
              }
            />
            <RefreshButton />
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <ConversationModeToggle conversationId={conversation.id} mode={conversation.mode} disabled={!canSend} />
          {hasPermission(user.role, "whatsapp:erase") ? <EraseConversationButton conversationId={conversation.id} /> : null}
        </div>
        {conversation.mode === "HUMAN" && conversation.handoffReason ? (
          <p className="rounded-lg bg-primary/[0.07] px-3 py-2 text-xs text-foreground/85">
            <span className="font-medium">Com a equipe</span>
            {conversation.handoffAt ? ` desde ${formatShortDateTime(conversation.handoffAt, timeZone)}` : ""}: {conversation.handoffReason}
          </p>
        ) : null}
        {conversation.tasks.length > 0 ? (
          <ul className="space-y-1">
            {conversation.tasks.map((task) => (
              <li key={task.id} className="flex flex-wrap items-center gap-2 text-xs">
                <StatusBadge tone={task.urgent ? "danger" : "warning"} label={task.urgent ? "Urgente" : TASK_KIND_LABELS[task.kind]} />
                <span className="text-foreground/85">{task.title}</span>
                <Link href="/tarefas" className="text-primary underline-offset-4 hover:underline">
                  tarefas
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
      </header>

      <ol className="flex-1 space-y-3 overflow-y-auto px-5 py-5" aria-label="Mensagens">
        {conversation.messages.length === 0 ? (
          <li className="text-sm text-muted-foreground">Nenhuma mensagem nesta conversa.</li>
        ) : (
          conversation.messages.map((message) => {
            const outbound = message.direction === "OUTBOUND";
            const automated = outbound && message.origin !== "STAFF";
            return (
              <li key={message.id} className={cn("flex", outbound ? "justify-end" : "justify-start")}>
                <div
                  className={cn(
                    "max-w-[85%] rounded-2xl px-4 py-2.5 text-sm",
                    outbound ? "rounded-br-md bg-primary-subtle" : "rounded-bl-md bg-muted",
                    automated && "bg-info-subtle",
                    message.status === "SIMULATED" && "border border-dashed border-info/50",
                    message.status === "FAILED" && "border border-destructive/40",
                  )}
                >
                  {automated ? (
                    <p className="mb-1 text-[0.6875rem] font-medium text-info">
                      {MESSAGE_ORIGIN_LABELS[message.origin]}
                      {message.templateName ? ` · modelo ${message.templateName}` : ""}
                    </p>
                  ) : message.templateName ? (
                    <p className="mb-1 text-[0.6875rem] text-muted-foreground">Modelo: {message.templateName}</p>
                  ) : null}
                  <p className="whitespace-pre-line text-foreground">{message.body ?? "[conteúdo apagado]"}</p>
                  <p className="mt-1 text-[0.6875rem] text-muted-foreground tabular-nums">
                    {formatShortDateTime(message.createdAt, timeZone)}
                    {outbound ? ` · ${MESSAGE_STATUS_LABELS[message.status]}` : ""}
                    {message.status === "PENDING" && message.nextAttemptAt
                      ? ` · nova tentativa ${formatShortDateTime(message.nextAttemptAt, timeZone)}`
                      : ""}
                    {message.sentBy ? ` · ${message.sentBy.name}` : ""}
                  </p>
                  {message.replyOfRun && message.origin === "ASSISTANT" ? (
                    <div className="mt-1.5 space-y-1 border-t border-border/60 pt-1.5 text-[0.6875rem] text-muted-foreground">
                      <p>
                        {message.replyOfRun.outcome ? ASSISTANT_OUTCOME_LABELS[message.replyOfRun.outcome] : "Resposta automática"}
                        {message.sources.length > 0 ? ` · fontes: ${message.sources.join("; ")}` : ""}
                      </p>
                      {canReport ? <ReportReplyButton messageId={message.id} reported={message.reported} /> : null}
                    </div>
                  ) : null}
                  {message.status === "FAILED" && message.errorMessage ? (
                    <p className="mt-1 text-xs text-destructive">{message.errorMessage}</p>
                  ) : null}
                </div>
              </li>
            );
          })
        )}
      </ol>

      <footer className="space-y-3 border-t border-border px-5 py-4">
        {status.provider === "development" && canSend ? <SimulateInbound conversationId={conversation.id} /> : null}
        <MessageComposer conversationId={conversation.id} disabledReason={disabledReason} simulated={status.provider === "development"} />
      </footer>
    </Panel>
  );
}
