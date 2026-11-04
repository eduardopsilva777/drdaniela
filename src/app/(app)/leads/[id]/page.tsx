import { ArrowLeft, CalendarPlus, Pencil } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense, type ReactNode } from "react";

import { AppointmentFormDialog } from "@/components/agenda/appointment-form-dialog";
import { AccessDenied } from "@/components/layout/access-denied";
import { PageContainer, PageHeader, Panel } from "@/components/layout/page";
import { InteractionForm } from "@/components/leads/interaction-form";
import { DeleteLeadButton, LeadStageMenu } from "@/components/leads/lead-detail-actions";
import { LeadFormDialog } from "@/components/leads/lead-form-dialog";
import { InteractionTimeline } from "@/components/timeline/interaction-timeline";
import { StatusBadge } from "@/components/ui-kit/status-badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { OpenConversationButton } from "@/components/whatsapp/open-conversation-button";
import { hasPermission } from "@/lib/auth/permissions";
import { dateKeyOf, timeOf, todayKey } from "@/lib/datetime";
import { formatDateTime } from "@/lib/format";
import {
  APPOINTMENT_STATUS_LABELS,
  APPOINTMENT_STATUS_TONES,
  LEAD_PRIORITY_LABELS,
  LEAD_PRIORITY_TONES,
  LEAD_SOURCE_LABELS,
  LEAD_STATUS_LABELS,
  LEAD_STATUS_TONES,
} from "@/lib/labels";
import { formatPhone } from "@/lib/phone";
import { describeDue } from "@/lib/relative-dates";
import { cn } from "@/lib/utils";
import { uuidSchema } from "@/lib/validation/common";
import { addLeadInteractionAction } from "@/server/actions/leads";
import { checkPermission } from "@/server/auth/dal";
import { getServerEnv } from "@/server/env";
import { NotFoundError } from "@/server/errors";
import { getActiveProcedureOptions, getProfessionalOptions, getStaffOptions } from "@/server/queries/catalog";
import { getLeadDetail, type LeadDetail } from "@/server/queries/leads";

export const metadata: Metadata = { title: "Lead" };

export default function LeadPage(props: PageProps<"/leads/[id]">) {
  return (
    <PageContainer>
      <Link href="/leads" className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft aria-hidden className="size-4" />
        Leads
      </Link>
      <Suspense fallback={<DetailFallback />}>
        <LeadDetailView params={props.params} />
      </Suspense>
    </PageContainer>
  );
}

function DetailFallback() {
  return (
    <div className="space-y-6" aria-hidden>
      <Skeleton className="h-10 w-80 max-w-full" />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Skeleton className="h-96 rounded-2xl" />
        <Skeleton className="h-96 rounded-2xl" />
      </div>
    </div>
  );
}

async function loadLead(id: string): Promise<LeadDetail> {
  try {
    return await getLeadDetail(id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}

async function LeadDetailView({ params }: { params: PageProps<"/leads/[id]">["params"] }) {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) notFound();

  const { user, allowed } = await checkPermission("leads:read");
  if (!allowed) return <AccessDenied resource="os leads" />;

  const [lead, procedures, staff, professionals] = await Promise.all([
    loadLead(id),
    getActiveProcedureOptions(),
    getStaffOptions(),
    getProfessionalOptions(),
  ]);
  const timeZone = getServerEnv().APP_TIMEZONE;
  const now = new Date();
  const canWrite = hasPermission(user.role, "leads:write");
  const canSchedule =
    hasPermission(user.role, "appointments:write") && !lead.patientId && lead.status !== "LOST" && lead.status !== "CONVERTED";
  const canDelete = hasPermission(user.role, "leads:delete") && !lead.patientId;
  const due = lead.nextActionAt ? describeDue(lead.nextActionAt, timeZone, now) : null;

  return (
    <>
      <PageHeader
        title={lead.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={LEAD_STATUS_TONES[lead.status]} label={LEAD_STATUS_LABELS[lead.status]} />
            <StatusBadge tone={LEAD_PRIORITY_TONES[lead.priority]} label={`Prioridade ${LEAD_PRIORITY_LABELS[lead.priority].toLowerCase()}`} />
            <span className="tabular-nums">{formatPhone(lead.phone)}</span>
          </span>
        }
        actions={
          canWrite ? (
            <div className="flex flex-wrap gap-2">
              {canSchedule ? (
                <AppointmentFormDialog
                  title="Agendar avaliação"
                  professionals={professionals.map((item) => ({ value: item.id, label: item.name }))}
                  procedures={procedures.map((item) => ({ value: item.id, label: item.name, durationMinutes: item.durationMinutes }))}
                  fixedSubject={{ kind: "lead", id: lead.id, name: lead.name }}
                  defaults={{ date: todayKey(timeZone, now), procedureId: lead.procedureId ?? undefined }}
                  trigger={
                    <Button>
                      <CalendarPlus aria-hidden />
                      Agendar
                    </Button>
                  }
                />
              ) : null}
              {hasPermission(user.role, "whatsapp:read") ? <OpenConversationButton subject={{ leadId: lead.id }} /> : null}
              <LeadFormDialog
                lead={{
                  id: lead.id,
                  name: lead.name,
                  phone: formatPhone(lead.phone),
                  email: lead.email,
                  source: lead.source,
                  sourceDetail: lead.sourceDetail,
                  interest: lead.interest,
                  procedureId: lead.procedureId,
                  priority: lead.priority,
                  ownerId: lead.ownerId,
                  notes: lead.notes,
                  whatsappOptIn: lead.whatsappOptIn,
                  nextActionDate: lead.nextActionAt ? dateKeyOf(lead.nextActionAt, timeZone) : null,
                  nextActionTime: lead.nextActionAt ? timeOf(lead.nextActionAt, timeZone) : null,
                  nextActionNote: lead.nextActionNote,
                }}
                procedures={procedures.map((item) => ({ value: item.id, label: item.name }))}
                staff={staff.map((item) => ({ value: item.id, label: item.name }))}
                trigger={
                  <Button variant="outline">
                    <Pencil aria-hidden />
                    Editar
                  </Button>
                }
              />
              <LeadStageMenu
                lead={{
                  id: lead.id,
                  name: lead.name,
                  status: lead.status,
                  phoneLabel: formatPhone(lead.phone),
                  email: lead.email,
                  whatsappOptIn: lead.whatsappOptIn,
                }}
              />
              {canDelete ? <DeleteLeadButton leadId={lead.id} leadName={lead.name} /> : null}
            </div>
          ) : null
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:gap-8">
        <div className="flex min-w-0 flex-col gap-6">
          {canWrite ? (
            <Panel aria-labelledby="registrar-titulo" className="p-6">
              <h2 id="registrar-titulo" className="mb-4 text-base font-medium text-foreground">
                Registrar interação
              </h2>
              <InteractionForm action={addLeadInteractionAction.bind(null, lead.id)} />
            </Panel>
          ) : null}
          <Panel aria-labelledby="historico-titulo" className="p-6">
            <h2 id="historico-titulo" className="mb-5 text-base font-medium text-foreground">
              Histórico
            </h2>
            <InteractionTimeline
              timeZone={timeZone}
              items={lead.interactions.map((item) => ({
                id: item.id,
                type: item.type,
                direction: item.direction,
                content: item.content,
                fromStatus: item.fromStatus,
                toStatus: item.toStatus,
                occurredAt: item.occurredAt,
                authorName: item.author?.name ?? null,
              }))}
            />
          </Panel>
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <Panel aria-labelledby="dados-titulo" className="p-6">
            <h2 id="dados-titulo" className="text-base font-medium text-foreground">
              Dados do lead
            </h2>
            <dl className="mt-4 space-y-3.5 text-sm">
              <Detail label="Próxima ação">
                {due ? (
                  <span className={cn(due.overdue && "text-brick")}>
                    {due.label}
                    {lead.nextActionNote ? <span className="block text-muted-foreground">{lead.nextActionNote}</span> : null}
                  </span>
                ) : (
                  "Nenhuma agendada"
                )}
              </Detail>
              <Detail label="Telefone">{formatPhone(lead.phone)}</Detail>
              <Detail label="E-mail">{lead.email ?? "—"}</Detail>
              <Detail label="Origem">
                {LEAD_SOURCE_LABELS[lead.source]}
                {lead.sourceDetail ? <span className="block text-muted-foreground">{lead.sourceDetail}</span> : null}
              </Detail>
              <Detail label="Interesse">
                {lead.procedure?.name ?? "—"}
                {lead.interest ? <span className="block text-muted-foreground">{lead.interest}</span> : null}
              </Detail>
              <Detail label="Responsável">{lead.owner?.name ?? "Sem responsável"}</Detail>
              <Detail label="WhatsApp">
                {lead.whatsappOptIn && lead.whatsappOptInAt
                  ? `Autorizado em ${formatDateTime(lead.whatsappOptInAt, timeZone)}`
                  : "Sem autorização registrada"}
              </Detail>
              {lead.status === "LOST" && lead.lostReason ? (
                <Detail label="Motivo da perda">
                  <span className="text-brick">{lead.lostReason}</span>
                </Detail>
              ) : null}
              {lead.patient ? (
                <Detail label="Paciente">
                  <Link href={`/pacientes/${lead.patient.id}`} className="text-rose underline-offset-4 hover:underline">
                    {lead.patient.fullName}
                  </Link>
                </Detail>
              ) : null}
              <Detail label="Cadastrado em">{formatDateTime(lead.createdAt, timeZone)}</Detail>
            </dl>
            {lead.notes ? (
              <div className="mt-5 border-t border-border pt-4">
                <p className="text-xs text-muted-foreground">Observações comerciais</p>
                <p className="mt-1 text-sm leading-relaxed whitespace-pre-line">{lead.notes}</p>
              </div>
            ) : null}
          </Panel>

          <Panel aria-labelledby="agenda-titulo" className="p-6">
            <h2 id="agenda-titulo" className="text-base font-medium text-foreground">
              Agendamentos
            </h2>
            {lead.appointments.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">Nenhum agendamento para este lead.</p>
            ) : (
              <ul className="mt-4 space-y-3">
                {lead.appointments.map((appointment) => (
                  <li key={appointment.id} className="flex items-start justify-between gap-3 text-sm">
                    <div className="min-w-0">
                      <Link
                        href={`/agenda?data=${dateKeyOf(appointment.startsAt, timeZone)}`}
                        className="text-foreground tabular-nums hover:underline hover:underline-offset-4"
                      >
                        {formatDateTime(appointment.startsAt, timeZone)}
                      </Link>
                      <p className="truncate text-xs text-muted-foreground">
                        {appointment.procedure?.name ?? "Avaliação"} com {appointment.professional.name}
                      </p>
                    </div>
                    <StatusBadge
                      tone={APPOINTMENT_STATUS_TONES[appointment.status]}
                      label={APPOINTMENT_STATUS_LABELS[appointment.status]}
                    />
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[8.5rem_minmax(0,1fr)] gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-foreground">{children}</dd>
    </div>
  );
}
