import { Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { ProcessQueueButton } from "@/components/care/process-queue-button";
import { ProtocolActiveToggle, ProtocolFormDialog } from "@/components/care/protocol-form-dialog";
import { ReminderActions, ReturnActions } from "@/components/care/return-actions";
import { SequenceActions } from "@/components/care/sequence-actions";
import { EmptyState } from "@/components/data/empty-state";
import { Pagination } from "@/components/data/pagination";
import { TableSkeleton } from "@/components/data/table-skeleton";
import { SearchFilter, SegmentedFilter } from "@/components/data/url-filters";
import { AccessDenied } from "@/components/layout/access-denied";
import { PageContainer, PageHeader, Panel } from "@/components/layout/page";
import { StatusBadge } from "@/components/ui-kit/status-badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { hasPermission } from "@/lib/auth/permissions";
import { dateKeyOf, dbDateToKey, formatKeyDate, todayKey } from "@/lib/datetime";
import { formatShortDateTime } from "@/lib/format";
import {
  MESSAGE_STATUS_LABELS,
  PROTOCOL_ANCHOR_LABELS,
  PROTOCOL_STEP_KIND_LABELS,
  REMINDER_KIND_LABELS,
  REMINDER_STATUS_LABELS,
  REMINDER_STATUS_TONES,
  RETURN_KIND_LABELS,
  RETURN_STATUS_LABELS,
  RETURN_STATUS_TONES,
  TEMPLATE_STATUS_LABELS,
} from "@/lib/labels";
import { formatPhone } from "@/lib/phone";
import { describeDueDateKey } from "@/lib/relative-dates";
import { cn } from "@/lib/utils";
import { returnFiltersSchema, type ReturnFilters } from "@/lib/validation/care";
import { checkPermission } from "@/server/auth/dal";
import type { SessionUser } from "@/server/auth/session-store";
import { getServerEnv } from "@/server/env";
import { listMessageTemplates } from "@/server/queries/assistant";
import { CARE_PAGE_SIZE, listProtocols, listReminders, listReturnsWorklist, UPCOMING_DAYS } from "@/server/queries/care";
import { getActiveProcedureOptions, getProfessionalOptions, listProcedures } from "@/server/queries/catalog";
import { getWhatsAppIntegrationStatus } from "@/server/whatsapp/provider";

export const metadata: Metadata = { title: "Protocolos e retornos" };

type SearchParams = PageProps<"/protocolos">["searchParams"];

const TABS = [
  { value: "retornos", label: "Retornos" },
  { value: "lembretes", label: "Lembretes" },
  { value: "protocolos", label: "Protocolos" },
] as const;

export default function ProtocolsPage(props: PageProps<"/protocolos">) {
  return (
    <PageContainer className="max-w-7xl">
      <PageHeader
        title="Protocolos e retornos"
        description="Retornos programados com os intervalos definidos pela profissional, a fila de lembretes e o catálogo de protocolos. O sistema apenas calcula datas — não faz recomendações clínicas."
      />
      <Suspense fallback={<Skeleton className="mb-6 h-10 w-full max-w-md" />}>
        <TabsNav searchParams={props.searchParams} />
      </Suspense>
      <Suspense fallback={<TableSkeleton rows={8} />}>
        <ProtocolsContent searchParams={props.searchParams} />
      </Suspense>
    </PageContainer>
  );
}

async function TabsNav({ searchParams }: { searchParams: SearchParams }) {
  const filters = returnFiltersSchema.parse(await searchParams);
  return (
    <nav aria-label="Seções" className="mb-6 overflow-x-auto">
      <ul className="flex min-w-max gap-1 border-b border-border">
        {TABS.map((tab) => (
          <li key={tab.value}>
            <Link
              href={tab.value === "retornos" ? "/protocolos" : `/protocolos?aba=${tab.value}`}
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

async function ProtocolsContent({ searchParams }: { searchParams: SearchParams }) {
  const { user, allowed } = await checkPermission("returns:read");
  if (!allowed) return <AccessDenied resource="os protocolos e retornos" />;
  const params = await searchParams;
  const filters = returnFiltersSchema.parse(params);

  if (filters.aba === "lembretes") return <RemindersTab filters={filters} user={user} />;
  if (filters.aba === "protocolos") return <CatalogTab user={user} includeInactive={params.inativos === "1"} />;
  return <ReturnsTab filters={filters} user={user} />;
}

// -----------------------------------------------------------------------------
// Fila de trabalho de retornos
// -----------------------------------------------------------------------------

async function ReturnsTab({ filters, user }: { filters: ReturnFilters; user: SessionUser }) {
  const timeZone = getServerEnv().APP_TIMEZONE;
  const today = todayKey(timeZone);
  const [{ total, items, counts }, professionals, procedures] = await Promise.all([
    listReturnsWorklist(filters, today),
    getProfessionalOptions(),
    getActiveProcedureOptions(),
  ]);
  const canWrite = hasPermission(user.role, "returns:write");
  const canSchedule = hasPermission(user.role, "appointments:write");
  const professionalChoices = professionals.map((item) => ({ value: item.id, label: item.name }));
  const procedureChoices = procedures.map((item) => ({ value: item.id, label: item.name, durationMinutes: item.durationMinutes }));

  return (
    <div className="space-y-4">
      <dl className="grid gap-3 sm:grid-cols-3">
        {[
          { label: "Atrasados", value: counts.overdue, href: "/protocolos?situacao=atrasados", tone: counts.overdue > 0 ? "text-destructive" : "text-foreground" },
          { label: `Próximos ${UPCOMING_DAYS} dias`, value: counts.upcoming, href: "/protocolos?situacao=proximos", tone: "text-foreground" },
          { label: "Pendentes ao todo", value: counts.open, href: "/protocolos", tone: "text-foreground" },
        ].map((item) => (
          <Link key={item.label} href={item.href} className="rounded-xl border border-border bg-card px-[1.125rem] py-4 transition-colors hover:border-primary/40">
            <dt className="text-sm text-muted-foreground">{item.label}</dt>
            <dd className={cn("mt-1 text-metric tabular-nums", item.tone)}>{item.value}</dd>
          </Link>
        ))}
      </dl>

      <div className="flex flex-wrap items-center gap-2.5">
        <SearchFilter placeholder="Buscar paciente por nome ou telefone" label="Buscar retornos por paciente" className="w-full sm:w-80" />
        <div className="sm:ml-auto">
          <SegmentedFilter
            param="situacao"
            label="Situação dos retornos"
            defaultValue="pendentes"
            options={[
              { value: "atrasados", label: "Atrasados" },
              { value: "proximos", label: "Próximos" },
              { value: "pendentes", label: "Pendentes" },
              { value: "resolvidos", label: "Resolvidos" },
            ]}
          />
        </div>
      </div>

      <Panel aria-label="Retornos" className="overflow-hidden">
        {total === 0 ? (
          <EmptyState
            title="Nenhum retorno nesta situação"
            description="Retornos são criados ao aplicar protocolos, ao registrar procedimentos com intervalo de retorno ou manualmente na ficha do paciente."
          />
        ) : (
          <>
            <ul className="divide-y divide-border">
              {items.map((item) => {
                const dueKey = dbDateToKey(item.dueDate);
                const due = describeDueDateKey(dueKey, today);
                const open = item.status === "PENDING" || item.status === "MISSED";
                return (
                  <li key={item.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                    <div className="min-w-0">
                      <Link
                        href={`/pacientes/${item.patient.id}?aba=protocolos`}
                        className="font-medium text-foreground hover:underline hover:underline-offset-4"
                      >
                        {item.patient.fullName}
                      </Link>
                      <span className="ml-2 text-xs text-muted-foreground tabular-nums">{formatPhone(item.patient.phone)}</span>
                      <p className="text-sm text-foreground/85">
                        {item.title}
                        <span className="text-muted-foreground">
                          {" "}
                          · {RETURN_KIND_LABELS[item.kind]}
                          {item.patientProtocol ? ` · ${item.patientProtocol.protocol.name}` : ""}
                        </span>
                      </p>
                      <p className={cn("text-xs tabular-nums", open && due.overdue ? "text-destructive" : "text-muted-foreground")}>
                        Previsto para {formatKeyDate(dueKey)}
                        {open ? ` · ${due.label}` : ""}
                        {item.appointment ? ` · agendado para ${formatShortDateTime(item.appointment.startsAt, timeZone)}` : ""}
                        {!item.patient.whatsappOptIn && open ? " · sem autorização de WhatsApp (contato manual)" : ""}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                      <StatusBadge tone={RETURN_STATUS_TONES[item.status]} label={RETURN_STATUS_LABELS[item.status]} />
                      {canWrite && item.patient.isActive ? (
                        <ReturnActions
                          item={{
                            id: item.id,
                            title: item.title,
                            status: item.status,
                            dueKey,
                            procedureId: item.procedure?.id ?? null,
                            appointmentDateKey: item.appointment ? dateKeyOf(item.appointment.startsAt, timeZone) : null,
                          }}
                          patient={{ id: item.patient.id, name: item.patient.fullName }}
                          todayKey={today}
                          canSchedule={canSchedule}
                          professionals={professionalChoices}
                          procedures={procedureChoices}
                        />
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
            <Pagination
              page={filters.pagina}
              pageSize={CARE_PAGE_SIZE}
              total={total}
              basePath="/protocolos"
              params={{ situacao: filters.situacao === "pendentes" ? undefined : filters.situacao, busca: filters.busca }}
            />
          </>
        )}
      </Panel>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Fila de lembretes
// -----------------------------------------------------------------------------

async function RemindersTab({ filters, user }: { filters: ReturnFilters; user: SessionUser }) {
  const timeZone = getServerEnv().APP_TIMEZONE;
  const integration = getWhatsAppIntegrationStatus();
  const { total, items, counts } = await listReminders(filters.lembrete, filters.busca, filters.pagina);
  const canWrite = hasPermission(user.role, "returns:write");

  return (
    <div className="space-y-4">
      <Panel
        className={cn(
          "flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6",
          integration.provider === "development" && "border-info/30",
          integration.provider === "disabled" && "border-warning/30",
        )}
      >
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
            <StatusBadge
              tone={integration.provider === "cloud_api" ? "success" : integration.provider === "development" ? "info" : "warning"}
              label={integration.title}
            />
          </p>
          <p className="mt-2 max-w-[70ch] text-sm text-muted-foreground">{integration.description}</p>
          {integration.provider === "cloud_api" && (!integration.templates.appointmentReminder || !integration.templates.returnReminder) ? (
            <p className="mt-2 text-sm text-warning">
              Configure os modelos aprovados na Meta (WHATSAPP_TEMPLATE_APPOINTMENT_REMINDER e WHATSAPP_TEMPLATE_RETURN_REMINDER):
              sem eles os lembretes falham com aviso.
            </p>
          ) : null}
        </div>
        {hasPermission(user.role, "reminders:process") ? (
          <ProcessQueueButton simulated={integration.provider === "development"} />
        ) : null}
      </Panel>

      <div className="flex flex-wrap items-center gap-2.5">
        <SearchFilter placeholder="Buscar paciente" label="Buscar lembretes por paciente" className="w-full sm:w-72" />
        <div className="sm:ml-auto">
          <SegmentedFilter
            param="lembrete"
            label="Status do lembrete"
            defaultValue=""
            options={[
              { value: "", label: "Todos" },
              ...(["PENDING", "PAUSED", "FAILED", "SENT", "CANCELLED"] as const).map((status) => ({
                value: status,
                label: `${status === "SENT" && integration.provider === "development" ? "Enviado/simulado" : REMINDER_STATUS_LABELS[status]} (${counts[status] ?? 0})`,
              })),
            ]}
          />
        </div>
      </div>

      <Panel aria-label="Lembretes" className="overflow-hidden">
        {total === 0 ? (
          <EmptyState
            title="Nenhum lembrete"
            description="Lembretes e etapas de acompanhamento são criados automaticamente para retornos e agendamentos. Sem autorização para mensagens, a etapa vira tarefa para a equipe."
          />
        ) : (
          <>
            <ul className="divide-y divide-border">
              {items.map((reminder) => (
                <li key={reminder.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                  <div className="min-w-0">
                    {reminder.patient ? (
                      <Link
                        href={`/pacientes/${reminder.patient.id}?aba=protocolos`}
                        className="font-medium text-foreground hover:underline hover:underline-offset-4"
                      >
                        {reminder.patient.fullName}
                      </Link>
                    ) : reminder.lead ? (
                      <Link href={`/leads/${reminder.lead.id}`} className="font-medium text-foreground hover:underline hover:underline-offset-4">
                        {reminder.lead.name} <span className="text-xs font-normal text-muted-foreground">(lead)</span>
                      </Link>
                    ) : null}
                    <p className="text-sm text-foreground/85">
                      {reminder.channel === "TASK" ? "Tarefa da equipe · " : ""}
                      {reminder.followUpRule
                        ? `Acompanhamento (${reminder.followUpRule.daysBefore} dia(s) antes)`
                        : REMINDER_KIND_LABELS[reminder.kind]}
                      {reminder.procedure ? <span className="text-muted-foreground"> · {reminder.procedure.name}</span> : null}
                      {reminder.return ? (
                        <span className="text-muted-foreground"> · retorno previsto para {formatKeyDate(dbDateToKey(reminder.return.dueDate))}</span>
                      ) : null}
                      {reminder.appointment ? (
                        <span className="text-muted-foreground"> · atendimento em {formatShortDateTime(reminder.appointment.startsAt, timeZone)}</span>
                      ) : null}
                    </p>
                    <p className="text-xs text-muted-foreground tabular-nums">
                      {reminder.sentAt
                        ? `${reminder.simulated ? "Simulado" : "Enviado"} em ${formatShortDateTime(reminder.sentAt, timeZone)}`
                        : reminder.cancelledAt
                          ? `Cancelado em ${formatShortDateTime(reminder.cancelledAt, timeZone)}`
                          : `Envio previsto para ${formatShortDateTime(reminder.scheduledFor, timeZone)}`}
                      {reminder.attempts > 0 ? ` · tentativa ${reminder.attempts} de ${reminder.maxAttempts}` : ""}
                      {reminder.nextAttemptAt && reminder.status === "PENDING"
                        ? ` · nova tentativa ${formatShortDateTime(reminder.nextAttemptAt, timeZone)}`
                        : ""}
                    </p>
                    {reminder.message && reminder.status === "SENT" && reminder.message.status !== "SIMULATED" ? (
                      <p className="text-xs text-muted-foreground">Entrega: {MESSAGE_STATUS_LABELS[reminder.message.status]}</p>
                    ) : null}
                    {reminder.task ? (
                      <p className="text-xs text-muted-foreground">
                        Tarefa {reminder.task.status === "OPEN" ? "aberta" : reminder.task.status === "DONE" ? "concluída" : "cancelada"} ·{" "}
                        <Link href="/tarefas" className="text-primary underline-offset-4 hover:underline">
                          ver tarefas
                        </Link>
                      </p>
                    ) : null}
                    {reminder.lastError && reminder.status !== "SENT" ? (
                      <p className={cn("text-xs", reminder.status === "FAILED" ? "text-destructive" : "text-muted-foreground")}>
                        {reminder.lastError}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                    <StatusBadge
                      tone={reminder.simulated && reminder.status === "SENT" ? "info" : REMINDER_STATUS_TONES[reminder.status]}
                      label={reminder.simulated && reminder.status === "SENT" ? "Simulado" : REMINDER_STATUS_LABELS[reminder.status]}
                    />
                    {canWrite &&
                    reminder.returnId &&
                    reminder.return?.status === "PENDING" &&
                    (reminder.status === "PENDING" || reminder.status === "PAUSED") ? (
                      <SequenceActions returnId={reminder.returnId} status={reminder.status} />
                    ) : null}
                    {canWrite ? <ReminderActions reminderId={reminder.id} status={reminder.status} /> : null}
                  </div>
                </li>
              ))}
            </ul>
            <Pagination
              page={filters.pagina}
              pageSize={CARE_PAGE_SIZE}
              total={total}
              basePath="/protocolos"
              params={{ aba: "lembretes", lembrete: filters.lembrete, busca: filters.busca }}
            />
          </>
        )}
      </Panel>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Catálogo de protocolos
// -----------------------------------------------------------------------------

async function CatalogTab({ user, includeInactive }: { user: SessionUser; includeInactive: boolean }) {
  const canManage = hasPermission(user.role, "procedures:manage");
  const [protocols, procedures, templates] = await Promise.all([
    listProtocols(includeInactive),
    listProcedures(false),
    canManage ? listMessageTemplates() : Promise.resolve([]),
  ]);
  const procedureOptions = procedures.map((item) => ({ value: item.id, label: item.name }));
  const templateOptions = templates
    .filter((template) => template.usage === "FOLLOW_UP" || template.usage === "RETURN_REMINDER")
    .map((template) => ({ value: template.id, label: `${template.name} — ${TEMPLATE_STATUS_LABELS[template.status]}` }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href={includeInactive ? "/protocolos?aba=protocolos" : "/protocolos?aba=protocolos&inativos=1"}
          className="text-sm text-primary underline-offset-4 hover:underline"
        >
          {includeInactive ? "Mostrar só ativos" : "Mostrar inativos"}
        </Link>
        {canManage ? (
          <ProtocolFormDialog
            procedures={procedureOptions}
            templates={templateOptions}
            trigger={
              <Button>
                <Plus aria-hidden />
                Novo protocolo
              </Button>
            }
          />
        ) : null}
      </div>

      {protocols.length === 0 ? (
        <Panel>
          <EmptyState
            title="Nenhum protocolo cadastrado"
            description={
              canManage
                ? "Cadastre a sequência de etapas e os intervalos que a profissional usa para cada procedimento."
                : "A profissional responsável ainda não cadastrou protocolos."
            }
          />
        </Panel>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {protocols.map((protocol) => (
            <Panel key={protocol.id} className={cn("flex flex-col p-6", !protocol.isActive && "opacity-70")}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-title-3 text-foreground">{protocol.name}</h2>
                  <p className="text-sm text-muted-foreground">
                    {protocol.procedure.name}
                    {!protocol.procedure.isActive ? " (procedimento inativo)" : ""}
                  </p>
                </div>
                <StatusBadge tone={protocol.isActive ? "success" : "muted"} label={protocol.isActive ? "Ativo" : "Inativo"} />
              </div>
              {protocol.description ? <p className="mt-3 text-sm text-foreground/85">{protocol.description}</p> : null}
              {protocol.durationDays ? (
                <p className="mt-2 text-xs text-muted-foreground tabular-nums">
                  Ciclo de {protocol.durationDays} dias (definido pela profissional)
                </p>
              ) : null}
              <ol className="mt-4 space-y-2 border-l border-border pl-4">
                {protocol.steps.map((step) => (
                  <li key={step.id} className="text-sm">
                    <span className="text-foreground">{step.label}</span>
                    <span className="text-muted-foreground tabular-nums">
                      {" "}
                      · {step.offsetDays} dias {PROTOCOL_ANCHOR_LABELS[step.relativeTo]}
                    </span>
                  </li>
                ))}
              </ol>
              <div className="mt-4 space-y-1">
                <p className="text-xs font-medium text-foreground">Acompanhamento antes de cada retorno</p>
                {protocol.followUpRules.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Lembrete padrão para quem autorizou (configurado no ambiente).</p>
                ) : (
                  <ul className="space-y-0.5 text-xs text-muted-foreground">
                    {protocol.followUpRules.map((rule) => (
                      <li key={rule.id}>
                        <span className="text-foreground/85 tabular-nums">
                          {rule.daysBefore === 0 ? "No dia" : `${rule.daysBefore} dia(s) antes`}
                        </span>
                        {" · "}
                        {rule.action === "MESSAGE"
                          ? `mensagem ${rule.template ? `“${rule.template.name}” (${TEMPLATE_STATUS_LABELS[rule.template.status].toLowerCase()})` : "sem modelo"}`
                          : `tarefa: ${rule.taskTitle ?? "contato da equipe"}`}
                        {rule.stepKinds.length > 0
                          ? ` · só ${rule.stepKinds.map((kind) => PROTOCOL_STEP_KIND_LABELS[kind].toLowerCase()).join(", ")}`
                          : ""}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-5">
                <p className="text-xs text-muted-foreground tabular-nums">
                  {protocol._count.patientProtocols} paciente(s) em andamento
                </p>
                {canManage ? (
                  <div className="flex gap-1">
                    <ProtocolFormDialog
                      procedures={procedureOptions}
                      templates={templateOptions}
                      protocol={{
                        id: protocol.id,
                        name: protocol.name,
                        procedureId: protocol.procedure.id,
                        description: protocol.description,
                        durationDays: protocol.durationDays ? String(protocol.durationDays) : "",
                        steps: protocol.steps.map((step) => ({
                          label: step.label,
                          kind: step.kind,
                          offsetDays: String(step.offsetDays),
                          relativeTo: step.relativeTo,
                        })),
                        followUpRules: protocol.followUpRules.map((rule) => ({
                          daysBefore: String(rule.daysBefore),
                          action: rule.action,
                          templateId: rule.template?.id ?? "",
                          taskTitle: rule.taskTitle ?? "",
                          stepKinds: rule.stepKinds,
                        })),
                      }}
                      trigger={
                        <Button variant="ghost" size="sm">
                          Editar
                        </Button>
                      }
                    />
                    <ProtocolActiveToggle protocolId={protocol.id} name={protocol.name} isActive={protocol.isActive} />
                  </div>
                ) : null}
              </div>
            </Panel>
          ))}
        </div>
      )}
    </div>
  );
}
