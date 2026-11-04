"use client";

import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { FormField } from "@/components/forms/form-field";
import { FormSelect, type SelectOption } from "@/components/forms/form-select";
import { Panel } from "@/components/layout/page";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/hooks/use-action";
import {
  QUALIFICATION_FIELD_LABELS,
  QUALIFICATION_FIELDS,
  type AssistantConfig,
  type AssistantMessages,
  type QualificationField,
} from "@/lib/assistant-config";
import { saveAssistantSettingsAction } from "@/server/actions/assistant";

const MESSAGE_FIELDS: Array<{ key: keyof AssistantMessages; label: string; hint?: string }> = [
  { key: "intro", label: "Apresentação (primeira resposta a uma pergunta)" },
  { key: "greeting", label: "Saudação (quando o contato só cumprimenta)" },
  { key: "askName", label: "Pedido do nome" },
  { key: "askNextStep", label: "Próximo passo após as perguntas de qualificação" },
  { key: "teamWillContact", label: "Confirmação de que a equipe fará contato" },
  { key: "handoff", label: "Encaminhamento para a equipe" },
  { key: "noAnswer", label: "Quando não há resposta aprovada", hint: "Deve admitir que não sabe e oferecer a equipe." },
  { key: "notUnderstood", label: "Quando não entende a mensagem" },
  { key: "clinicalDeflection", label: "Dúvida de saúde (vai para a equipe)", hint: "Nunca orientar clinicamente." },
  { key: "urgentHealth", label: "Possível urgência de saúde", hint: "Orientar a procurar atendimento de urgência." },
  { key: "optOutConfirmation", label: "Confirmação de descadastro (PARAR, SAIR…)" },
  { key: "optInConfirmation", label: "Confirmação de recadastro (VOLTAR)" },
  { key: "consentQuestion", label: "Pergunta de consentimento para lembretes" },
  { key: "bookingConfirmed", label: "Agendamento confirmado", hint: "Enviada só depois que o horário é gravado." },
  { key: "rescheduled", label: "Remarcação confirmada" },
  { key: "appointmentCancelled", label: "Cancelamento confirmado" },
  { key: "closing", label: "Agradecimento e despedida" },
];

const WEEKDAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
const FIELD_OPTIONS: SelectOption[] = QUALIFICATION_FIELDS.map((value) => ({ value, label: QUALIFICATION_FIELD_LABELS[value] }));

function NumberField({
  id,
  label,
  value,
  min,
  max,
  onChange,
  description,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  description?: string;
}) {
  return (
    <FormField label={label} htmlFor={id} description={description}>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={Number.isFinite(value) ? value : ""}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </FormField>
  );
}

function Section({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <Panel className="space-y-5 p-5 sm:p-6">
      <div className="space-y-1">
        <h2 className="text-base font-medium text-foreground">{title}</h2>
        {description ? <p className="max-w-[70ch] text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {children}
    </Panel>
  );
}

export function AssistantSettingsForm({
  initial,
  procedures,
  professionals,
  readOnly,
}: {
  initial: AssistantConfig;
  procedures: SelectOption[];
  professionals: SelectOption[];
  readOnly: boolean;
}) {
  const [config, setConfig] = useState<AssistantConfig>(initial);
  const { run, pending } = useAction(saveAssistantSettingsAction);

  const update = <K extends keyof AssistantConfig>(key: K, value: AssistantConfig[K]) => setConfig((current) => ({ ...current, [key]: value }));
  const updateBooking = <K extends keyof AssistantConfig["booking"]>(key: K, value: AssistantConfig["booking"][K]) =>
    setConfig((current) => ({ ...current, booking: { ...current.booking, [key]: value } }));
  const updateProactive = <K extends keyof AssistantConfig["proactive"]>(key: K, value: AssistantConfig["proactive"][K]) =>
    setConfig((current) => ({ ...current, proactive: { ...current.proactive, [key]: value } }));
  const updateLimits = <K extends keyof AssistantConfig["limits"]>(key: K, value: AssistantConfig["limits"][K]) =>
    setConfig((current) => ({ ...current, limits: { ...current.limits, [key]: value } }));

  function updateHours(day: number, index: number, part: "start" | "end", value: string) {
    setConfig((current) => {
      const weeklyHours = current.booking.weeklyHours.map((ranges, position) =>
        position === day ? ranges.map((range, rangeIndex) => (rangeIndex === index ? { ...range, [part]: value } : range)) : ranges,
      );
      return { ...current, booking: { ...current.booking, weeklyHours } };
    });
  }

  function setRanges(day: number, ranges: AssistantConfig["booking"]["weeklyHours"][number]) {
    setConfig((current) => ({
      ...current,
      booking: { ...current.booking, weeklyHours: current.booking.weeklyHours.map((item, position) => (position === day ? ranges : item)) },
    }));
  }

  function moveQuestion(index: number, direction: -1 | 1) {
    setConfig((current) => {
      const next = [...current.qualification];
      const target = index + direction;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target]!, next[index]!];
      return { ...current, qualification: next };
    });
  }

  return (
    <form
      noValidate
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (!readOnly) run(JSON.stringify(config));
      }}
    >
      <fieldset disabled={readOnly} className="space-y-5">
        <Section
          title="Geral"
          description="O assistente se apresenta como assistente virtual da clínica — nunca como a Dra. Daniela — e responde só com a base de conhecimento aprovada."
        >
          <label className="flex items-center gap-3 text-sm text-foreground">
            <Switch checked={config.enabled} onCheckedChange={(checked) => update("enabled", checked)} />
            Assistente ativo (desligado, todas as conversas ficam com a equipe; descadastros continuam valendo)
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Nome do assistente" htmlFor="settings-assistant-name">
              <Input id="settings-assistant-name" value={config.assistantName} maxLength={60} onChange={(event) => update("assistantName", event.target.value)} />
            </FormField>
            <FormField label="Nome da clínica" htmlFor="settings-clinic-name">
              <Input id="settings-clinic-name" value={config.clinicName} maxLength={80} onChange={(event) => update("clinicName", event.target.value)} />
            </FormField>
          </div>
          <FormField
            label="Horário em que a equipe responde"
            htmlFor="settings-team-hours"
            optional
            description="Texto livre usado em {horario_equipe} (ex.: segunda a sexta, das 9h às 18h). Deixe vazio para não informar."
          >
            <Input id="settings-team-hours" value={config.teamHoursText} maxLength={120} onChange={(event) => update("teamHoursText", event.target.value)} />
          </FormField>
        </Section>

        <Section
          title="Mensagens"
          description="Marcadores disponíveis: {assistente}, {clinica}, {nome}, {horario_equipe}; nas confirmações de agenda também {data}, {hora} e {procedimento}."
        >
          <div className="grid gap-4 lg:grid-cols-2">
            {MESSAGE_FIELDS.map((field) => (
              <FormField key={field.key} label={field.label} htmlFor={`settings-message-${field.key}`} description={field.hint}>
                <Textarea
                  id={`settings-message-${field.key}`}
                  rows={3}
                  maxLength={500}
                  value={config.messages[field.key]}
                  onChange={(event) => update("messages", { ...config.messages, [field.key]: event.target.value })}
                />
              </FormField>
            ))}
          </div>
        </Section>

        <Section
          title="Perguntas de qualificação"
          description="Feitas uma por vez a novos contatos, depois do nome, para registrar o lead. Colete só o necessário (LGPD) e nunca pergunte sobre saúde."
        >
          <ol className="space-y-3">
            {config.qualification.map((question, index) => (
              <li key={question.id} className="rounded-xl border border-border p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground">Pergunta {index + 1}</span>
                  <div className="flex gap-1">
                    <Button type="button" variant="ghost" size="icon-xs" aria-label={`Subir pergunta ${index + 1}`} disabled={index === 0} onClick={() => moveQuestion(index, -1)}>
                      <ArrowUp aria-hidden />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Descer pergunta ${index + 1}`}
                      disabled={index === config.qualification.length - 1}
                      onClick={() => moveQuestion(index, 1)}
                    >
                      <ArrowDown aria-hidden />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Remover pergunta ${index + 1}`}
                      onClick={() => update("qualification", config.qualification.filter((_, position) => position !== index))}
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
                  <FormSelect
                    id={`settings-question-field-${index}`}
                    name={`questionField${index}`}
                    value={question.field}
                    options={FIELD_OPTIONS}
                    onValueChange={(value) =>
                      update(
                        "qualification",
                        config.qualification.map((item, position) => (position === index ? { ...item, field: value as QualificationField } : item)),
                      )
                    }
                  />
                  <Input
                    aria-label={`Texto da pergunta ${index + 1}`}
                    value={question.question}
                    maxLength={200}
                    onChange={(event) =>
                      update(
                        "qualification",
                        config.qualification.map((item, position) => (position === index ? { ...item, question: event.target.value } : item)),
                      )
                    }
                  />
                </div>
              </li>
            ))}
          </ol>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={config.qualification.length >= 6}
            onClick={() =>
              update("qualification", [
                ...config.qualification,
                { id: `pergunta_${Date.now().toString(36)}`, field: "custom", question: "" },
              ])
            }
          >
            <Plus aria-hidden />
            Adicionar pergunta
          </Button>
        </Section>

        <Section
          title="Agendamento pelo assistente"
          description="Com o agendamento ativo, o assistente oferece horários realmente livres da agenda, pede confirmação explícita (SIM) e só confirma depois de gravar. Desativado, ele encaminha o pedido para a equipe."
        >
          <label className="flex items-center gap-3 text-sm text-foreground">
            <Switch checked={config.booking.enabled} onCheckedChange={(checked) => updateBooking("enabled", checked)} />
            Permitir que o assistente agende, remarque e cancele
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Procedimento agendado pelo assistente" htmlFor="settings-booking-procedure" description="Ex.: avaliação. A duração vem do cadastro do procedimento.">
              <FormSelect
                id="settings-booking-procedure"
                name="bookingProcedure"
                value={config.booking.procedureId ?? ""}
                options={procedures}
                emptyLabel="Nenhum"
                onValueChange={(value) => updateBooking("procedureId", value || null)}
              />
            </FormField>
            <fieldset className="space-y-2">
              <legend className="mb-1 text-[0.8125rem] font-medium">Profissionais com agenda aberta ao assistente</legend>
              {professionals.length === 0 ? <p className="text-xs text-muted-foreground">Nenhuma profissional ativa.</p> : null}
              {professionals.map((professional) => (
                <label key={professional.value} className="flex items-center gap-2 text-sm text-foreground">
                  <Checkbox
                    checked={config.booking.professionalIds.includes(professional.value)}
                    onCheckedChange={(checked) =>
                      updateBooking(
                        "professionalIds",
                        checked
                          ? [...config.booking.professionalIds, professional.value]
                          : config.booking.professionalIds.filter((id) => id !== professional.value),
                      )
                    }
                  />
                  {professional.label}
                </label>
              ))}
            </fieldset>
          </div>
          <fieldset className="space-y-2">
            <legend className="mb-1 text-[0.8125rem] font-medium">Horários em que o assistente pode agendar</legend>
            <div className="divide-y divide-border rounded-xl border border-border">
              {WEEKDAYS.map((label, day) => {
                const ranges = config.booking.weeklyHours[day] ?? [];
                return (
                  <div key={label} className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center">
                    <span className="w-24 shrink-0 text-sm text-foreground">{label}</span>
                    <div className="flex flex-1 flex-wrap items-center gap-2">
                      {ranges.length === 0 ? <span className="text-xs text-muted-foreground">Fechado</span> : null}
                      {ranges.map((range, index) => (
                        <span key={index} className="flex items-center gap-1">
                          <Input
                            aria-label={`${label}: início do período ${index + 1}`}
                            type="time"
                            className="h-8 w-28"
                            value={range.start}
                            onChange={(event) => updateHours(day, index, "start", event.target.value)}
                          />
                          <span className="text-xs text-muted-foreground">às</span>
                          <Input
                            aria-label={`${label}: fim do período ${index + 1}`}
                            type="time"
                            className="h-8 w-28"
                            value={range.end}
                            onChange={(event) => updateHours(day, index, "end", event.target.value)}
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            aria-label={`Remover período ${index + 1} de ${label}`}
                            onClick={() => setRanges(day, ranges.filter((_, position) => position !== index))}
                          >
                            <Trash2 aria-hidden />
                          </Button>
                        </span>
                      ))}
                      {ranges.length < 3 ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setRanges(day, [...ranges, { start: "09:00", end: "12:00" }])}
                        >
                          <Plus aria-hidden />
                          Período
                        </Button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-4">
            <NumberField id="settings-slot-step" label="Intervalo entre horários (min)" value={config.booking.slotStepMinutes} min={10} max={120} onChange={(value) => updateBooking("slotStepMinutes", value)} />
            <NumberField id="settings-min-notice" label="Antecedência mínima (h)" value={config.booking.minNoticeHours} min={0} max={168} onChange={(value) => updateBooking("minNoticeHours", value)} />
            <NumberField id="settings-days-ahead" label="Até quantos dias à frente" value={config.booking.maxDaysAhead} min={1} max={90} onChange={(value) => updateBooking("maxDaysAhead", value)} />
            <NumberField id="settings-max-options" label="Opções oferecidas" value={config.booking.maxOptions} min={2} max={6} onChange={(value) => updateBooking("maxOptions", value)} />
          </div>
          <label className="flex items-center gap-3 text-sm text-foreground">
            <Switch checked={config.askReminderConsent} onCheckedChange={(checked) => update("askReminderConsent", checked)} />
            Depois de agendar, perguntar se o contato aceita lembretes pelo WhatsApp (consentimento registrado)
          </label>
        </Section>

        <Section
          title="Mensagens iniciadas pela clínica"
          description="Lembretes e acompanhamento só saem nesses dias e horários, com limite por contato. Fora da janela de 24 horas, apenas modelos aprovados pela Meta."
        >
          <fieldset className="flex flex-wrap gap-3">
            <legend className="mb-2 text-[0.8125rem] font-medium">Dias permitidos</legend>
            {WEEKDAYS.map((label, day) => (
              <label key={label} className="flex items-center gap-2 text-sm text-foreground">
                <Checkbox
                  checked={config.proactive.allowedWeekdays.includes(day)}
                  onCheckedChange={(checked) =>
                    updateProactive(
                      "allowedWeekdays",
                      checked
                        ? [...config.proactive.allowedWeekdays, day].sort()
                        : config.proactive.allowedWeekdays.filter((item) => item !== day),
                    )
                  }
                />
                {label}
              </label>
            ))}
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-4">
            <FormField label="A partir de" htmlFor="settings-proactive-start">
              <Input id="settings-proactive-start" type="time" value={config.proactive.startTime} onChange={(event) => updateProactive("startTime", event.target.value)} />
            </FormField>
            <FormField label="Até" htmlFor="settings-proactive-end">
              <Input id="settings-proactive-end" type="time" value={config.proactive.endTime} onChange={(event) => updateProactive("endTime", event.target.value)} />
            </FormField>
            <NumberField id="settings-max-day" label="Máximo por dia" value={config.proactive.maxPerDay} min={1} max={5} onChange={(value) => updateProactive("maxPerDay", value)} />
            <NumberField id="settings-max-week" label="Máximo por semana" value={config.proactive.maxPerWeek} min={1} max={14} onChange={(value) => updateProactive("maxPerWeek", value)} />
          </div>
        </Section>

        <Section title="Proteções" description="Evitam conversas em círculo, repetição e confirmação de horários antigos.">
          <div className="grid gap-4 sm:grid-cols-3">
            <NumberField
              id="settings-max-replies"
              label="Respostas automáticas por hora (por conversa)"
              value={config.limits.maxRepliesPerHour}
              min={5}
              max={60}
              onChange={(value) => updateLimits("maxRepliesPerHour", value)}
            />
            <NumberField
              id="settings-max-unknown"
              label="Mensagens sem resposta antes de chamar a equipe"
              value={config.limits.maxUnknownBeforeHandoff}
              min={1}
              max={5}
              onChange={(value) => updateLimits("maxUnknownBeforeHandoff", value)}
            />
            <NumberField
              id="settings-state-ttl"
              label="Validade de um atendimento em andamento (h)"
              value={config.limits.stateTtlHours}
              min={1}
              max={72}
              onChange={(value) => updateLimits("stateTtlHours", value)}
            />
          </div>
        </Section>
      </fieldset>

      {!readOnly ? (
        <div className="sticky bottom-4 flex justify-end">
          <Button type="submit" disabled={pending} className="shadow-lg">
            {pending ? "Salvando…" : "Salvar configurações"}
          </Button>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Somente a administração altera estas configurações.</p>
      )}
    </form>
  );
}
