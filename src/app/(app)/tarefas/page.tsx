import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { EmptyState } from "@/components/data/empty-state";
import { Pagination } from "@/components/data/pagination";
import { TableSkeleton } from "@/components/data/table-skeleton";
import { SegmentedFilter } from "@/components/data/url-filters";
import { AccessDenied } from "@/components/layout/access-denied";
import { PageContainer, PageHeader, Panel } from "@/components/layout/page";
import { TaskActions } from "@/components/tasks/task-actions";
import { StatusBadge } from "@/components/ui-kit/status-badge";
import type { TaskKind } from "@/generated/prisma/enums";
import { formatShortDateTime } from "@/lib/format";
import { TASK_KIND_LABELS, TASK_KIND_TONES, TASK_STATUS_LABELS } from "@/lib/labels";
import { taskFiltersSchema } from "@/lib/validation/assistant";
import { checkPermission } from "@/server/auth/dal";
import { getServerEnv } from "@/server/env";
import { ASSISTANT_PAGE_SIZE, listTasks } from "@/server/queries/assistant";

export const metadata: Metadata = { title: "Tarefas" };

const KINDS: TaskKind[] = ["HANDOFF", "QUALIFIED_LEAD", "FOLLOW_UP", "AUTOMATION_FAILURE"];

export default function TasksPage(props: PageProps<"/tarefas">) {
  return (
    <PageContainer>
      <PageHeader
        title="Tarefas"
        description="O que precisa da equipe: conversas encaminhadas pelo assistente, oportunidades qualificadas, contatos de acompanhamento de protocolos e falhas de automação."
      />
      <Suspense fallback={<TableSkeleton rows={8} />}>
        <TasksContent searchParams={props.searchParams} />
      </Suspense>
    </PageContainer>
  );
}

async function TasksContent({ searchParams }: { searchParams: PageProps<"/tarefas">["searchParams"] }) {
  const { allowed } = await checkPermission("tasks:work");
  if (!allowed) return <AccessDenied resource="as tarefas da equipe" />;
  const filters = taskFiltersSchema.parse(await searchParams);
  const { total, tasks, openByKind } = await listTasks(filters);
  const timeZone = getServerEnv().APP_TIMEZONE;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedFilter
          param="situacao"
          label="Situação"
          defaultValue="abertas"
          options={[
            { value: "abertas", label: "Abertas" },
            { value: "encerradas", label: "Encerradas" },
          ]}
        />
        <SegmentedFilter
          param="tipo"
          label="Tipo de tarefa"
          defaultValue=""
          options={[
            { value: "", label: "Todos" },
            ...KINDS.map((kind) => ({ value: kind, label: `${TASK_KIND_LABELS[kind]} (${openByKind[kind] ?? 0})` })),
          ]}
        />
      </div>
      <Panel aria-label="Tarefas" className="overflow-hidden">
        {tasks.length === 0 ? (
          <EmptyState
            title={filters.situacao === "abertas" ? "Nenhuma tarefa aberta" : "Nenhuma tarefa encerrada"}
            description="Tarefas são criadas quando o assistente encaminha uma conversa, qualifica um lead, quando uma etapa de acompanhamento é de contato manual ou quando uma automação falha."
          />
        ) : (
          <>
            <ul className="divide-y divide-border">
              {tasks.map((task) => (
                <li key={task.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {task.urgent ? <StatusBadge tone="danger" label="Urgente" /> : null}
                      <StatusBadge tone={TASK_KIND_TONES[task.kind]} label={TASK_KIND_LABELS[task.kind]} />
                      <p className="font-medium text-foreground">{task.title}</p>
                    </div>
                    {task.details ? <p className="text-sm text-foreground/85">{task.details}</p> : null}
                    <p className="text-xs text-muted-foreground">
                      Criada em {formatShortDateTime(task.createdAt, timeZone)}
                      {task.status !== "OPEN" && task.completedAt
                        ? ` · ${TASK_STATUS_LABELS[task.status].toLowerCase()} em ${formatShortDateTime(task.completedAt, timeZone)}${task.completedBy ? ` por ${task.completedBy.name}` : ""}`
                        : ""}
                    </p>
                    <p className="flex flex-wrap gap-3 text-xs">
                      {task.conversationId ? (
                        <Link href={`/whatsapp?conversa=${task.conversationId}`} className="text-primary underline-offset-4 hover:underline">
                          Abrir conversa
                        </Link>
                      ) : null}
                      {task.lead ? (
                        <Link href={`/leads/${task.lead.id}`} className="text-primary underline-offset-4 hover:underline">
                          Lead: {task.lead.name}
                        </Link>
                      ) : null}
                      {task.patient ? (
                        <Link href={`/pacientes/${task.patient.id}`} className="text-primary underline-offset-4 hover:underline">
                          Paciente: {task.patient.fullName}
                        </Link>
                      ) : null}
                    </p>
                  </div>
                  {task.status === "OPEN" ? <TaskActions taskId={task.id} /> : null}
                </li>
              ))}
            </ul>
            <Pagination
              page={filters.pagina}
              pageSize={ASSISTANT_PAGE_SIZE}
              total={total}
              basePath="/tarefas"
              params={{ situacao: filters.situacao === "abertas" ? undefined : filters.situacao, tipo: filters.tipo }}
            />
          </>
        )}
      </Panel>
    </div>
  );
}
