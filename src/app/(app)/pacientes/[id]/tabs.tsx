import { CalendarSync, ClipboardPlus, Lock, Plus } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { AppointmentFormDialog } from "@/components/agenda/appointment-form-dialog";
import type { Choice, ProcedureChoice } from "@/components/agenda/types";
import {
  ApplyProtocolDialog,
  CancelProtocolButton,
  ProcedureRecordDialog,
  ReturnCreateDialog,
} from "@/components/care/care-dialogs";
import { ReminderActions, ReturnActions } from "@/components/care/return-actions";
import { EmptyState } from "@/components/data/empty-state";
import { Panel } from "@/components/layout/page";
import { InteractionForm } from "@/components/leads/interaction-form";
import { PatientNoteForm, PatientNoteList } from "@/components/patients/patient-notes";
import { InteractionTimeline } from "@/components/timeline/interaction-timeline";
import { StatusBadge } from "@/components/ui-kit/status-badge";
import { Button } from "@/components/ui/button";
import { OpenConversationButton } from "@/components/whatsapp/open-conversation-button";
import { hasPermission } from "@/lib/auth/permissions";
import { dateKeyOf, dbDateToKey, formatKeyDate } from "@/lib/datetime";
import { formatDateTime, formatShortDateTime } from "@/lib/format";
import {
  APPOINTMENT_STATUS_LABELS,
  APPOINTMENT_STATUS_TONES,
  LEAD_SOURCE_LABELS,
  MESSAGE_STATUS_LABELS,
  PATIENT_PROTOCOL_STATUS_LABELS,
  PATIENT_PROTOCOL_STATUS_TONES,
  REMINDER_KIND_LABELS,
  REMINDER_STATUS_LABELS,
  REMINDER_STATUS_TONES,
  RETURN_KIND_LABELS,
  RETURN_STATUS_LABELS,
  RETURN_STATUS_TONES,
} from "@/lib/labels";
import { describeDueDateKey } from "@/lib/relative-dates";
import { cn } from "@/lib/utils";
import { addPatientInteractionAction } from "@/server/actions/patients";
import type { SessionUser } from "@/server/auth/session-store";
import { getNoteKeyring, isNoteEncryptionConfigured } from "@/server/crypto/note-key";
import { getDb } from "@/server/db";
import { getProtocolOptions } from "@/server/queries/catalog";
import {
  getPatientAppointments,
  getPatientCare,
  getPatientInteractions,
  getPatientMessages,
  getPatientOverview,
  getPatientProcedureRecords,
  type PatientProfile,
} from "@/server/queries/patients";
import { getRequestMeta } from "@/server/request-meta";
import { readPatientNotes } from "@/server/services/patients";

export interface TabContext {
  patient: PatientProfile;
  user: SessionUser;
  timeZone: string;
  now: Date;
  today: string;
  professionals: Choice[];
  procedures: Array<ProcedureChoice & { suggestedReturnDays: number | null }>;
}

function Section({
  title,
  action,
  children,
  className,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const id = `secao-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <Panel aria-labelledby={id} className={cn("p-6", className)}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 id={id} className="text-title-3 text-foreground">
          {title}
        </h2>
        {action}
      </div>
      {children}
    </Panel>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[9rem_minmax(0,1fr)] gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-foreground">{children}</dd>
    </div>
  );
}

function Muted({ children }: { children: ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

// -----------------------------------------------------------------------------
// Resumo
// -----------------------------------------------------------------------------

export async function SummaryTab({ context }: { context: TabContext }) {
  const { patient, timeZone, now, today } = context;
  const overview = await getPatientOverview(patient.id, now);
  const consents = [
    { label: "WhatsApp", granted: patient.whatsappOptIn, at: patient.whatsappOptInAt },
    { label: "Comunicações promocionais", granted: patient.marketingOptIn, at: patient.marketingOptInAt },
    { label: "Uso de imagem", granted: patient.imageUseConsent, at: patient.imageUseConsentAt },
  ];

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)] lg:gap-8">
      <div className="flex min-w-0 flex-col gap-6">
        <Section title="Próximos agendamentos">
          {overview.upcomingAppointments.length === 0 ? (
            <Muted>Nenhum agendamento futuro.</Muted>
          ) : (
            <ul className="space-y-3">
              {overview.upcomingAppointments.map((item) => (
                <li key={item.id} className="flex items-start justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <Link
                      href={`/agenda?visao=dia&data=${dateKeyOf(item.startsAt, timeZone)}`}
                      className="text-foreground tabular-nums hover:underline hover:underline-offset-4"
                    >
                      {formatDateTime(item.startsAt, timeZone)}
                    </Link>
                    <p className="truncate text-xs text-muted-foreground">
                      {item.procedure?.name ?? "Avaliação"} com {item.professional.name}
                    </p>
                  </div>
                  <StatusBadge tone={APPOINTMENT_STATUS_TONES[item.status]} label={APPOINTMENT_STATUS_LABELS[item.status]} />
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Retornos pendentes">
          {overview.pendingReturns.length === 0 ? (
            <Muted>Nenhum retorno pendente.</Muted>
          ) : (
            <ul className="space-y-3">
              {overview.pendingReturns.map((item) => {
                const dueKey = dbDateToKey(item.dueDate);
                const due = describeDueDateKey(dueKey, today);
                const pending = item.status === "PENDING";
                return (
                  <li key={item.id} className="flex items-start justify-between gap-3 text-sm">
                    <div className="min-w-0">
                      <p className="text-foreground">{item.title}</p>
                      <p className={cn("text-xs tabular-nums", pending && due.overdue ? "text-destructive" : "text-muted-foreground")}>
                        Previsto para {formatKeyDate(dueKey)}
                        {pending ? ` · ${due.label}` : ""}
                      </p>
                    </div>
                    <StatusBadge tone={RETURN_STATUS_TONES[item.status]} label={RETURN_STATUS_LABELS[item.status]} />
                  </li>
                );
              })}
            </ul>
          )}
          <Link href={`/pacientes/${patient.id}?aba=protocolos`} className="mt-4 inline-block text-sm text-primary underline-offset-4 hover:underline">
            Ver protocolos e retornos
          </Link>
        </Section>

        <Section title="Tratamento">
          <dl className="space-y-3 text-sm">
            <Detail label="Protocolos ativos">
              {overview.activeProtocols.length === 0
                ? "Nenhum"
                : overview.activeProtocols.map((item) => (
                    <span key={item.id} className="block">
                      {item.protocol.name}
                      <span className="text-muted-foreground"> · desde {formatKeyDate(dbDateToKey(item.startedOn))}</span>
                    </span>
                  ))}
            </Detail>
            <Detail label="Último procedimento">
              {overview.lastRecord
                ? `${overview.lastRecord.procedure.name} em ${formatKeyDate(dateKeyOf(overview.lastRecord.performedAt, timeZone))}`
                : "Nenhum registrado"}
            </Detail>
          </dl>
        </Section>
      </div>

      <div className="flex min-w-0 flex-col gap-6">
        <Section title="Dados cadastrais">
          <dl className="space-y-3 text-sm">
            <Detail label="E-mail">{patient.email ?? "—"}</Detail>
            <Detail label="Nascimento">{patient.birthDate ? formatKeyDate(dbDateToKey(patient.birthDate)) : "Não informado"}</Detail>
            <Detail label="Origem">
              {patient.source ? LEAD_SOURCE_LABELS[patient.source] : "Não informada"}
              {patient.sourceDetail ? <span className="block text-muted-foreground">{patient.sourceDetail}</span> : null}
            </Detail>
            <Detail label="Cadastrado em">{formatDateTime(patient.createdAt, timeZone)}</Detail>
          </dl>
        </Section>

        <Section title="Consentimentos">
          <ul className="space-y-3 text-sm">
            {consents.map((consent) => (
              <li key={consent.label} className="flex items-start justify-between gap-3">
                <span className="text-foreground">{consent.label}</span>
                <span className={cn("text-right text-xs tabular-nums", consent.granted ? "text-success" : "text-muted-foreground")}>
                  {consent.granted ? "Autorizado" : "Não autorizado"}
                  {consent.at ? <span className="block text-muted-foreground">em {formatShortDateTime(consent.at, timeZone)}</span> : null}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-muted-foreground">Cada alteração fica registrada na auditoria (LGPD).</p>
        </Section>

        {patient.lead ? (
          <Section title="Origem comercial">
            <dl className="space-y-3 text-sm">
              <Detail label="Interesse">
                {patient.lead.procedure?.name ?? patient.lead.interest ?? "—"}
                {patient.lead.procedure && patient.lead.interest ? (
                  <span className="block text-muted-foreground">{patient.lead.interest}</span>
                ) : null}
              </Detail>
              <Detail label="Lead desde">{formatKeyDate(dateKeyOf(patient.lead.createdAt, timeZone))}</Detail>
              <Detail label="Convertido em">
                {patient.lead.convertedAt ? formatKeyDate(dateKeyOf(patient.lead.convertedAt, timeZone)) : "—"}
              </Detail>
            </dl>
            {hasPermission(context.user.role, "leads:read") ? (
              <Link href={`/leads/${patient.lead.id}`} className="mt-4 inline-block text-sm text-primary underline-offset-4 hover:underline">
                Abrir histórico do lead
              </Link>
            ) : null}
          </Section>
        ) : null}
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Agenda
// -----------------------------------------------------------------------------

export async function AgendaTab({ context }: { context: TabContext }) {
  const { patient, timeZone, today, user } = context;
  const appointments = await getPatientAppointments(patient.id);
  const canWrite = hasPermission(user.role, "appointments:write") && patient.isActive;

  return (
    <Section
      title="Histórico de agendamentos"
      action={
        canWrite ? (
          <AppointmentFormDialog
            professionals={context.professionals}
            procedures={context.procedures}
            fixedSubject={{ kind: "patient", id: patient.id, name: patient.fullName }}
            defaults={{ date: today }}
            trigger={
              <Button size="sm">
                <Plus aria-hidden />
                Novo agendamento
              </Button>
            }
          />
        ) : null
      }
    >
      {appointments.length === 0 ? (
        <Muted>Nenhum agendamento registrado.</Muted>
      ) : (
        <ul className="divide-y divide-border">
          {appointments.map((item) => (
            <li key={item.id} className="flex flex-wrap items-start justify-between gap-3 py-3 text-sm first:pt-0 last:pb-0">
              <div className="min-w-0">
                <Link
                  href={`/agenda?visao=dia&data=${dateKeyOf(item.startsAt, timeZone)}`}
                  className="text-foreground tabular-nums hover:underline hover:underline-offset-4"
                >
                  {formatDateTime(item.startsAt, timeZone)}
                </Link>
                <p className="text-xs text-muted-foreground">
                  {item.procedure?.name ?? "Avaliação"} com {item.professional.name}
                </p>
                {item.cancellationReason ? <p className="text-xs text-destructive">Motivo: {item.cancellationReason}</p> : null}
              </div>
              <StatusBadge tone={APPOINTMENT_STATUS_TONES[item.status]} label={APPOINTMENT_STATUS_LABELS[item.status]} />
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

// -----------------------------------------------------------------------------
// Procedimentos realizados
// -----------------------------------------------------------------------------

export async function ProceduresTab({ context }: { context: TabContext }) {
  const { patient, timeZone, today, user } = context;
  const records = await getPatientProcedureRecords(patient.id);

  return (
    <Section
      title="Procedimentos realizados"
      action={
        hasPermission(user.role, "patients:write") ? (
          <ProcedureRecordDialog
            patientId={patient.id}
            procedures={context.procedures}
            professionals={context.professionals}
            todayKey={today}
            trigger={
              <Button size="sm" variant="outline">
                <ClipboardPlus aria-hidden />
                Registrar procedimento
              </Button>
            }
          />
        ) : null
      }
    >
      {records.length === 0 ? (
        <EmptyState
          className="px-0 py-4 sm:px-0"
          title="Nenhum procedimento registrado"
          description="Concluir um agendamento com procedimento registra automaticamente o histórico."
        />
      ) : (
        <ul className="divide-y divide-border">
          {records.map((record) => (
            <li key={record.id} className="py-3 text-sm first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-medium text-foreground">{record.procedure.name}</p>
                <time className="text-xs text-muted-foreground tabular-nums" dateTime={record.performedAt.toISOString()}>
                  {formatDateTime(record.performedAt, timeZone)}
                </time>
              </div>
              <p className="text-xs text-muted-foreground">
                {record.professional ? `Com ${record.professional.name}` : "Profissional não informado"}
                {record.patientProtocol ? ` · ${record.patientProtocol.protocol.name}` : ""}
                {record.protocolStep ? ` (${record.protocolStep.label})` : ""}
              </p>
              {record.notes ? <p className="mt-1 text-foreground/85">{record.notes}</p> : null}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

// -----------------------------------------------------------------------------
// Protocolos, retornos e lembretes
// -----------------------------------------------------------------------------

export async function ProtocolsTab({ context }: { context: TabContext }) {
  const { patient, timeZone, today, user } = context;
  const canAssign = hasPermission(user.role, "protocols:assign") && patient.isActive;
  const canWriteReturns = hasPermission(user.role, "returns:write");
  const canSchedule = hasPermission(user.role, "appointments:write") && patient.isActive;
  const [care, protocolOptions] = await Promise.all([
    getPatientCare(patient.id),
    canAssign ? getProtocolOptions() : Promise.resolve([]),
  ]);

  const returnRow = (item: (typeof care.returns)[number]) => ({
    id: item.id,
    title: item.title,
    status: item.status,
    dueKey: dbDateToKey(item.dueDate),
    procedureId: item.procedure?.id ?? null,
    appointmentDateKey: item.appointment ? dateKeyOf(item.appointment.startsAt, timeZone) : null,
  });

  const renderReturns = (items: typeof care.returns) => (
    <ul className="divide-y divide-border">
      {items.map((item) => {
        const row = returnRow(item);
        const open = item.status === "PENDING" || item.status === "MISSED";
        const due = describeDueDateKey(row.dueKey, today);
        return (
          <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm first:pt-0 last:pb-0">
            <div className="min-w-0">
              <p className="text-foreground">
                {item.title}
                <span className="text-muted-foreground"> · {RETURN_KIND_LABELS[item.kind]}</span>
              </p>
              <p className={cn("text-xs tabular-nums", open && due.overdue ? "text-destructive" : "text-muted-foreground")}>
                Previsto para {formatKeyDate(row.dueKey)}
                {open ? ` · ${due.label}` : ""}
                {item.appointment ? ` · agendado para ${formatDateTime(item.appointment.startsAt, timeZone)}` : ""}
              </p>
              {item.notes ? <p className="text-xs text-muted-foreground">{item.notes}</p> : null}
            </div>
            <div className="flex items-center gap-2">
              <StatusBadge tone={RETURN_STATUS_TONES[item.status]} label={RETURN_STATUS_LABELS[item.status]} />
              {canWriteReturns ? (
                <ReturnActions
                  item={row}
                  patient={{ id: patient.id, name: patient.fullName }}
                  todayKey={today}
                  canSchedule={canSchedule}
                  professionals={context.professionals}
                  procedures={context.procedures}
                />
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );

  const standalone = care.returns.filter((item) => !item.patientProtocolId);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap gap-2">
        {canAssign ? (
          <ApplyProtocolDialog
            patientId={patient.id}
            protocols={protocolOptions}
            professionals={context.professionals}
            todayKey={today}
            trigger={
              <Button>
                <CalendarSync aria-hidden />
                Aplicar protocolo
              </Button>
            }
          />
        ) : null}
        {canWriteReturns && patient.isActive ? (
          <ReturnCreateDialog
            patientId={patient.id}
            procedures={context.procedures}
            todayKey={today}
            trigger={
              <Button variant="outline">
                <Plus aria-hidden />
                Programar retorno
              </Button>
            }
          />
        ) : null}
      </div>

      {care.protocols.length === 0 && standalone.length === 0 ? (
        <Panel>
          <EmptyState
            title="Nenhum protocolo ou retorno"
            description="Aplique um protocolo (os retornos são calculados com os intervalos definidos pela profissional) ou programe um retorno avulso."
          />
        </Panel>
      ) : null}

      {care.protocols.map((protocol) => {
        const items = care.returns.filter((item) => item.patientProtocolId === protocol.id);
        return (
          <Section
            key={protocol.id}
            title={protocol.protocol.name}
            action={
              <div className="flex items-center gap-2">
                <StatusBadge tone={PATIENT_PROTOCOL_STATUS_TONES[protocol.status]} label={PATIENT_PROTOCOL_STATUS_LABELS[protocol.status]} />
                {protocol.status === "ACTIVE" && hasPermission(user.role, "protocols:assign") ? (
                  <CancelProtocolButton patientProtocolId={protocol.id} name={protocol.protocol.name} />
                ) : null}
              </div>
            }
          >
            <p className="-mt-2 mb-4 text-xs text-muted-foreground">
              {protocol.protocol.procedure.name} · início em {formatKeyDate(dbDateToKey(protocol.startedOn))}
              {protocol.cancellationReason ? ` · cancelado: ${protocol.cancellationReason}` : ""}
            </p>
            {items.length === 0 ? <Muted>Sem retornos programados.</Muted> : renderReturns(items)}
          </Section>
        );
      })}

      {standalone.length > 0 ? <Section title="Retornos avulsos">{renderReturns(standalone)}</Section> : null}

      <Section title="Lembretes">
        {!patient.whatsappOptIn ? (
          <p className="mb-3 text-sm text-warning">
            Sem autorização para WhatsApp: lembretes não são criados para este paciente.
          </p>
        ) : null}
        {care.reminders.length === 0 ? (
          <Muted>Nenhum lembrete registrado.</Muted>
        ) : (
          <ul className="divide-y divide-border">
            {care.reminders.map((reminder) => (
              <li key={reminder.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <p className="text-foreground">
                    {REMINDER_KIND_LABELS[reminder.kind]}
                    {reminder.procedure ? <span className="text-muted-foreground"> · {reminder.procedure.name}</span> : null}
                  </p>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {reminder.sentAt
                      ? `${reminder.simulated ? "Simulado" : "Enviado"} em ${formatShortDateTime(reminder.sentAt, timeZone)}`
                      : `Previsto para ${formatShortDateTime(reminder.scheduledFor, timeZone)}`}
                    {reminder.attempts > 0 ? ` · ${reminder.attempts} tentativa(s)` : ""}
                  </p>
                  {reminder.lastError && reminder.status !== "SENT" ? (
                    <p className="text-xs text-muted-foreground">{reminder.lastError}</p>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge
                    tone={reminder.simulated ? "info" : REMINDER_STATUS_TONES[reminder.status]}
                    label={reminder.simulated && reminder.status === "SENT" ? "Simulado" : REMINDER_STATUS_LABELS[reminder.status]}
                  />
                  {canWriteReturns ? <ReminderActions reminderId={reminder.id} status={reminder.status} /> : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Mensagens
// -----------------------------------------------------------------------------

export async function MessagesTab({ context }: { context: TabContext }) {
  const { patient, timeZone } = context;
  const conversations = await getPatientMessages(patient.id);
  const messages = conversations
    .flatMap((conversation) => conversation.messages)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  return (
    <Section title="Mensagens pelo WhatsApp" action={<OpenConversationButton subject={{ patientId: patient.id }} label="Abrir conversa" />}>
      {messages.length === 0 ? (
        <Muted>Nenhuma mensagem registrada com este paciente.</Muted>
      ) : (
        <ol className="space-y-3">
          {messages.map((message) => (
            <li key={message.id} className={cn("flex", message.direction === "OUTBOUND" ? "justify-end" : "justify-start")}>
              <div
                className={cn(
                  "max-w-[85%] rounded-2xl px-4 py-2.5 text-sm",
                  message.direction === "OUTBOUND" ? "bg-primary-subtle text-foreground" : "bg-muted text-foreground",
                )}
              >
                <p className="whitespace-pre-line">{message.body ?? "[conteúdo apagado]"}</p>
                <p className="mt-1 text-[0.6875rem] text-muted-foreground tabular-nums">
                  {formatShortDateTime(message.createdAt, timeZone)} · {MESSAGE_STATUS_LABELS[message.status]}
                  {message.templateName ? " · modelo" : ""}
                </p>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Section>
  );
}

// -----------------------------------------------------------------------------
// Interações
// -----------------------------------------------------------------------------

export async function InteractionsTab({ context }: { context: TabContext }) {
  const { patient, timeZone, user } = context;
  const interactions = await getPatientInteractions(patient.id);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] lg:gap-8">
      {hasPermission(user.role, "patients:write") ? (
        <Section title="Registrar interação" className="self-start">
          <InteractionForm action={addPatientInteractionAction.bind(null, patient.id)} showNextAction={false} />
        </Section>
      ) : null}
      <Section title="Linha do tempo" className={hasPermission(user.role, "patients:write") ? undefined : "lg:col-span-2"}>
        <InteractionTimeline
          timeZone={timeZone}
          items={interactions.map((item) => ({
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
      </Section>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Observações (cifradas; clínicas com acesso restrito e auditado)
// -----------------------------------------------------------------------------

export async function NotesTab({ context }: { context: TabContext }) {
  const { patient, timeZone, user } = context;

  if (!isNoteEncryptionConfigured()) {
    return (
      <Panel role="alert" className="p-6">
        <p className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Lock aria-hidden className="size-4 text-warning" />
          Observações indisponíveis
        </p>
        <p className="mt-1.5 max-w-[60ch] text-sm text-muted-foreground">
          A chave de cifragem (DATA_ENCRYPTION_KEY) não está configurada no servidor. As observações nunca são gravadas sem
          cifragem; peça à responsável técnica para configurar a chave.
        </p>
      </Panel>
    );
  }

  const meta = await getRequestMeta();
  const { includeClinical, notes } = await readPatientNotes(
    getDb(),
    { id: user.id, name: user.name, role: user.role, ...meta },
    patient.id,
    getNoteKeyring(),
  );
  const canWriteClinical = hasPermission(user.role, "clinical-notes:write");

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] lg:gap-8">
      {hasPermission(user.role, "patients:write") || canWriteClinical ? (
        <Section title="Nova observação" className="self-start">
          <PatientNoteForm patientId={patient.id} canWriteClinical={canWriteClinical} />
        </Section>
      ) : null}
      <Section title="Observações">
        {!includeClinical ? (
          <p className="mb-4 flex items-center gap-2 text-xs text-muted-foreground">
            <Lock aria-hidden className="size-3.5" />
            Observações clínicas ficam visíveis apenas para profissionais e administração.
          </p>
        ) : null}
        <PatientNoteList
          notes={notes.map((note) => ({
            id: note.id,
            visibility: note.visibility,
            content: note.content,
            readable: note.readable,
            authorName: note.authorName,
            createdAtLabel: formatDateTime(note.createdAt, timeZone),
          }))}
        />
      </Section>
    </div>
  );
}
