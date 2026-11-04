import { ArrowLeft, CalendarPlus, Download, Pencil } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { AppointmentFormDialog } from "@/components/agenda/appointment-form-dialog";
import { AccessDenied } from "@/components/layout/access-denied";
import { PageHeader } from "@/components/layout/page";
import { PatientFormDialog } from "@/components/patients/patient-form-dialog";
import { PatientStatusButton } from "@/components/patients/patient-status-button";
import { StatusBadge } from "@/components/ui-kit/status-badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { OpenConversationButton } from "@/components/whatsapp/open-conversation-button";
import { hasPermission, type Permission } from "@/lib/auth/permissions";
import { ageOn, dateKeyOf, dbDateToKey, formatKeyDate, todayKey } from "@/lib/datetime";
import { formatPhone } from "@/lib/phone";
import { cn } from "@/lib/utils";
import { uuidSchema } from "@/lib/validation/common";
import { PATIENT_TABS, type PatientTab } from "@/lib/validation/patients";
import { checkPermission } from "@/server/auth/dal";
import { getServerEnv } from "@/server/env";
import { NotFoundError } from "@/server/errors";
import { getActiveProcedureOptions, getProfessionalOptions } from "@/server/queries/catalog";
import { getPatientProfile, type PatientProfile } from "@/server/queries/patients";

import {
  AgendaTab,
  InteractionsTab,
  MessagesTab,
  NotesTab,
  ProceduresTab,
  ProtocolsTab,
  SummaryTab,
  type TabContext,
} from "./tabs";

export const metadata: Metadata = { title: "Paciente" };

const TAB_LABELS: Record<PatientTab, string> = {
  resumo: "Resumo",
  agenda: "Agenda",
  procedimentos: "Procedimentos",
  protocolos: "Protocolos e retornos",
  mensagens: "Mensagens",
  interacoes: "Interações",
  observacoes: "Observações",
};

const TAB_PERMISSIONS: Record<PatientTab, Permission> = {
  resumo: "patients:read",
  agenda: "appointments:read",
  procedimentos: "patients:read",
  protocolos: "returns:read",
  mensagens: "whatsapp:read",
  interacoes: "patients:read",
  observacoes: "patients:read",
};

export default function PatientPage(props: PageProps<"/pacientes/[id]">) {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-10 lg:py-12">
      <Link href="/pacientes" className="mb-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft aria-hidden className="size-4" />
        Pacientes
      </Link>
      <Suspense fallback={<ProfileFallback />}>
        <PatientView params={props.params} searchParams={props.searchParams} />
      </Suspense>
    </div>
  );
}

function ProfileFallback() {
  return (
    <div className="space-y-6" aria-hidden>
      <Skeleton className="h-10 w-80 max-w-full" />
      <Skeleton className="h-9 w-full max-w-2xl" />
      <Skeleton className="h-80 rounded-2xl" />
    </div>
  );
}

async function loadPatient(id: string): Promise<PatientProfile> {
  try {
    return await getPatientProfile(id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}

async function PatientView({
  params,
  searchParams,
}: {
  params: PageProps<"/pacientes/[id]">["params"];
  searchParams: PageProps<"/pacientes/[id]">["searchParams"];
}) {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) notFound();

  const { user, allowed } = await checkPermission("patients:read");
  if (!allowed) return <AccessDenied resource="os pacientes" />;

  const query = await searchParams;
  const requested = typeof query.aba === "string" ? query.aba : "resumo";
  const visibleTabs = PATIENT_TABS.filter((tab) => hasPermission(user.role, TAB_PERMISSIONS[tab]));
  const tab: PatientTab = (visibleTabs as readonly string[]).includes(requested) ? (requested as PatientTab) : "resumo";

  const [patient, professionals, procedures] = await Promise.all([
    loadPatient(id),
    getProfessionalOptions(),
    getActiveProcedureOptions(),
  ]);

  const timeZone = getServerEnv().APP_TIMEZONE;
  const now = new Date();
  const today = todayKey(timeZone, now);
  const can = (permission: Permission) => hasPermission(user.role, permission);
  const birthKey = patient.birthDate ? dbDateToKey(patient.birthDate) : null;
  const professionalChoices = professionals.map((item) => ({ value: item.id, label: item.name }));
  const procedureChoices = procedures.map((item) => ({
    value: item.id,
    label: item.name,
    durationMinutes: item.durationMinutes,
    suggestedReturnDays: item.suggestedReturnDays,
  }));

  const context: TabContext = {
    patient,
    user,
    timeZone,
    now,
    today,
    professionals: professionalChoices,
    procedures: procedureChoices,
  };

  return (
    <>
      <PageHeader
        title={patient.fullName}
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <StatusBadge tone={patient.isActive ? "sage" : "muted"} label={patient.isActive ? "Ativo" : "Inativo"} />
            {patient.preferredName ? <span>Prefere “{patient.preferredName}”</span> : null}
            <span className="tabular-nums">{formatPhone(patient.phone)}</span>
            {birthKey ? <span className="tabular-nums">{ageOn(birthKey, today)} anos</span> : null}
            <span>Paciente desde {formatKeyDate(dateKeyOf(patient.createdAt, timeZone))}</span>
          </span>
        }
        actions={
          <div className="flex flex-wrap justify-end gap-2">
            {can("appointments:write") && patient.isActive ? (
              <AppointmentFormDialog
                professionals={professionalChoices}
                procedures={procedureChoices}
                fixedSubject={{ kind: "patient", id: patient.id, name: patient.fullName }}
                defaults={{ date: today }}
                trigger={
                  <Button>
                    <CalendarPlus aria-hidden />
                    Agendar
                  </Button>
                }
              />
            ) : null}
            {can("patients:write") ? (
              <PatientFormDialog
                patient={{
                  id: patient.id,
                  fullName: patient.fullName,
                  preferredName: patient.preferredName,
                  phone: formatPhone(patient.phone),
                  email: patient.email,
                  birthDate: birthKey,
                  source: patient.source,
                  sourceDetail: patient.sourceDetail,
                  whatsappOptIn: patient.whatsappOptIn,
                  marketingOptIn: patient.marketingOptIn,
                  imageUseConsent: patient.imageUseConsent,
                }}
                trigger={
                  <Button variant="outline">
                    <Pencil aria-hidden />
                    Editar
                  </Button>
                }
              />
            ) : null}
            {can("whatsapp:read") ? <OpenConversationButton subject={{ patientId: patient.id }} /> : null}
            {can("patients:export") ? (
              <a
                href={`/api/pacientes/${patient.id}/exportar`}
                className={buttonVariants({ variant: "ghost" })}
                title="Exportação dos dados do paciente (LGPD). A operação fica registrada na auditoria."
              >
                <Download aria-hidden />
                Exportar dados
              </a>
            ) : null}
            {can("patients:archive") ? (
              <PatientStatusButton patientId={patient.id} patientName={patient.fullName} isActive={patient.isActive} />
            ) : null}
          </div>
        }
      />

      {!patient.isActive ? (
        <p className="mb-6 rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          Cadastro inativo
          {patient.inactivatedAt ? ` desde ${formatKeyDate(dateKeyOf(patient.inactivatedAt, timeZone))}` : ""}
          {patient.inactivationReason ? ` — ${patient.inactivationReason}` : ""}. O histórico continua disponível; novos
          agendamentos e lembretes ficam bloqueados.
        </p>
      ) : null}

      <nav aria-label="Seções da ficha" className="-mx-4 mb-6 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <ul className="flex min-w-max gap-1 border-b border-border">
          {visibleTabs.map((item) => (
            <li key={item}>
              <Link
                href={item === "resumo" ? `/pacientes/${patient.id}` : `/pacientes/${patient.id}?aba=${item}`}
                aria-current={item === tab ? "page" : undefined}
                scroll={false}
                className={cn(
                  "-mb-px inline-flex h-10 items-center border-b-2 px-3 text-sm transition-colors",
                  item === tab
                    ? "border-rose text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {TAB_LABELS[item]}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <Suspense key={tab} fallback={<Skeleton className="h-72 rounded-2xl" />}>
        {tab === "resumo" ? <SummaryTab context={context} /> : null}
        {tab === "agenda" ? <AgendaTab context={context} /> : null}
        {tab === "procedimentos" ? <ProceduresTab context={context} /> : null}
        {tab === "protocolos" ? <ProtocolsTab context={context} /> : null}
        {tab === "mensagens" ? <MessagesTab context={context} /> : null}
        {tab === "interacoes" ? <InteractionsTab context={context} /> : null}
        {tab === "observacoes" ? <NotesTab context={context} /> : null}
      </Suspense>
    </>
  );
}
