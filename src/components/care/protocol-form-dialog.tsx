"use client";

import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";

import { ConfirmDialog } from "@/components/forms/confirm-dialog";
import { fieldAria, FormField } from "@/components/forms/form-field";
import { FormSelect, type SelectOption } from "@/components/forms/form-select";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { FollowUpAction, ProtocolStepAnchor, ProtocolStepKind } from "@/generated/prisma/enums";
import { useAction } from "@/hooks/use-action";
import { useResetOnHide } from "@/hooks/use-reset-on-hide";
import { firstFieldError } from "@/lib/action-result";
import { FOLLOW_UP_ACTION_LABELS, PROTOCOL_ANCHOR_LABELS, PROTOCOL_STEP_KIND_LABELS } from "@/lib/labels";
import { saveProtocolAction, setProtocolActiveAction } from "@/server/actions/care";

export interface ProtocolStepValue {
  label: string;
  kind: ProtocolStepKind;
  offsetDays: string;
  relativeTo: ProtocolStepAnchor;
}

export interface FollowUpRuleValue {
  daysBefore: string;
  action: FollowUpAction;
  templateId: string;
  taskTitle: string;
  stepKinds: ProtocolStepKind[];
}

export interface ProtocolFormValues {
  id: string;
  name: string;
  procedureId: string;
  description: string | null;
  durationDays: string;
  steps: ProtocolStepValue[];
  followUpRules: FollowUpRuleValue[];
}

const ACTION_OPTIONS = (Object.keys(FOLLOW_UP_ACTION_LABELS) as FollowUpAction[]).map((value) => ({
  value,
  label: FOLLOW_UP_ACTION_LABELS[value],
}));
const STEP_KINDS = Object.keys(PROTOCOL_STEP_KIND_LABELS) as ProtocolStepKind[];
const EMPTY_RULE: FollowUpRuleValue = { daysBefore: "7", action: "MESSAGE", templateId: "", taskTitle: "", stepKinds: [] };

const KIND_OPTIONS = (Object.keys(PROTOCOL_STEP_KIND_LABELS) as ProtocolStepKind[]).map((value) => ({
  value,
  label: PROTOCOL_STEP_KIND_LABELS[value],
}));
const ANCHOR_OPTIONS = (Object.keys(PROTOCOL_ANCHOR_LABELS) as ProtocolStepAnchor[]).map((value) => ({
  value,
  label: `dias ${PROTOCOL_ANCHOR_LABELS[value]}`,
}));

const EMPTY_STEP: ProtocolStepValue = { label: "", kind: "REVIEW", offsetDays: "", relativeTo: "START" };

/**
 * Cadastro de protocolo: sequência de etapas com intervalos definidos pela
 * profissional. O sistema só calcula datas a partir desses intervalos.
 */
export function ProtocolFormDialog({
  protocol,
  procedures,
  templates,
  trigger,
}: {
  protocol?: ProtocolFormValues;
  procedures: SelectOption[];
  /** Modelos da Meta disponíveis para mensagens de acompanhamento. */
  templates: SelectOption[];
  trigger: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const initialSteps = protocol?.steps.length ? protocol.steps : [{ ...EMPTY_STEP }];
  const [steps, setSteps] = useState<ProtocolStepValue[]>(initialSteps);
  const [rules, setRules] = useState<FollowUpRuleValue[]>(protocol?.followUpRules ?? []);
  const action = saveProtocolAction.bind(null, protocol?.id ?? null);
  const { run, pending, fieldErrors, reset } = useAction(action, { onSuccess: () => setOpen(false) });
  useResetOnHide(() => setOpen(false));
  const error = (field: string) => firstFieldError(fieldErrors, field);
  const stepsError = fieldErrors?.steps?.[0];
  const rulesError = fieldErrors?.followUpRules?.[0];

  function updateRule(index: number, changes: Partial<FollowUpRuleValue>) {
    setRules((current) => current.map((rule, position) => (position === index ? { ...rule, ...changes } : rule)));
  }

  function update(index: number, changes: Partial<ProtocolStepValue>) {
    setSteps((current) => current.map((step, position) => (position === index ? { ...step, ...changes } : step)));
  }

  function move(index: number, direction: -1 | 1) {
    setSteps((current) => {
      const next = [...current];
      const target = index + direction;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setSteps(initialSteps);
          setRules(protocol?.followUpRules ?? []);
        } else {
          reset();
        }
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{protocol ? "Editar protocolo" : "Novo protocolo"}</DialogTitle>
          <DialogDescription>
            Os intervalos são definidos pela profissional responsável. Alterações valem para novas aplicações; retornos já
            programados mantêm suas datas.
          </DialogDescription>
        </DialogHeader>

        <form
          noValidate
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            data.set(
              "steps",
              JSON.stringify(steps.map((step) => ({ ...step, offsetDays: step.offsetDays === "" ? "" : Number(step.offsetDays) }))),
            );
            data.set(
              "followUpRules",
              JSON.stringify(
                rules.map((rule) => ({
                  daysBefore: rule.daysBefore === "" ? "" : Number(rule.daysBefore),
                  action: rule.action,
                  templateId: rule.action === "MESSAGE" ? rule.templateId : "",
                  taskTitle: rule.taskTitle,
                  stepKinds: rule.stepKinds,
                })),
              ),
            );
            run(data);
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Nome do protocolo" htmlFor="protocol-name" error={error("name")}>
              <Input {...fieldAria("protocol-name", error("name"))} name="name" defaultValue={protocol?.name} maxLength={120} />
            </FormField>
            <FormField label="Procedimento" htmlFor="protocol-procedure" error={error("procedureId")}>
              <FormSelect
                id="protocol-procedure"
                name="procedureId"
                defaultValue={protocol?.procedureId}
                options={procedures}
                placeholder="Selecione o procedimento"
                invalid={Boolean(error("procedureId"))}
              />
            </FormField>
          </div>
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_11rem]">
            <FormField
              label="Descrição administrativa"
              htmlFor="protocol-description"
              optional
              error={error("description")}
              description="Sem orientações clínicas: use para identificar o protocolo para a equipe."
            >
              <Textarea
                {...fieldAria("protocol-description", error("description"), true)}
                name="description"
                rows={2}
                maxLength={500}
                defaultValue={protocol?.description ?? ""}
              />
            </FormField>
            <FormField
              label="Duração do ciclo (dias)"
              htmlFor="protocol-duration"
              optional
              error={error("durationDays")}
              description="Definida pela profissional; só informativa."
            >
              <Input
                {...fieldAria("protocol-duration", error("durationDays"), true)}
                name="durationDays"
                type="number"
                inputMode="numeric"
                min={1}
                max={3650}
                defaultValue={protocol?.durationDays ?? ""}
              />
            </FormField>
          </div>

          <fieldset className="space-y-3">
            <legend className="mb-1 text-[0.8125rem] font-medium">Etapas e intervalos</legend>
            {stepsError ? <p className="text-xs text-brick">{stepsError}</p> : null}
            <ol className="space-y-3">
              {steps.map((step, index) => (
                <li key={index} className="rounded-xl border border-border p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground">Etapa {index + 1}</span>
                    <div className="flex gap-1">
                      <Button type="button" variant="ghost" size="icon-xs" aria-label={`Subir etapa ${index + 1}`} disabled={index === 0} onClick={() => move(index, -1)}>
                        <ArrowUp aria-hidden />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`Descer etapa ${index + 1}`}
                        disabled={index === steps.length - 1}
                        onClick={() => move(index, 1)}
                      >
                        <ArrowDown aria-hidden />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`Remover etapa ${index + 1}`}
                        disabled={steps.length === 1}
                        onClick={() => setSteps((current) => current.filter((_, position) => position !== index))}
                      >
                        <Trash2 aria-hidden />
                      </Button>
                    </div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
                    <Input
                      aria-label={`Nome da etapa ${index + 1}`}
                      placeholder="Ex.: Revisão"
                      value={step.label}
                      maxLength={80}
                      onChange={(event) => update(index, { label: event.target.value })}
                    />
                    <FormSelect
                      id={`step-kind-${index}`}
                      name={`stepKind${index}`}
                      value={step.kind}
                      options={KIND_OPTIONS}
                      onValueChange={(value) => update(index, { kind: value as ProtocolStepKind })}
                    />
                  </div>
                  <div className="mt-3 grid grid-cols-[6.5rem_minmax(0,1fr)] items-center gap-3">
                    <Input
                      aria-label={`Intervalo em dias da etapa ${index + 1}`}
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={3650}
                      placeholder="Dias"
                      value={step.offsetDays}
                      onChange={(event) => update(index, { offsetDays: event.target.value })}
                    />
                    <FormSelect
                      id={`step-anchor-${index}`}
                      name={`stepAnchor${index}`}
                      value={step.relativeTo}
                      options={index === 0 ? ANCHOR_OPTIONS.filter((option) => option.value === "START") : ANCHOR_OPTIONS}
                      onValueChange={(value) => update(index, { relativeTo: value as ProtocolStepAnchor })}
                    />
                  </div>
                </li>
              ))}
            </ol>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={steps.length >= 20}
              onClick={() => setSteps((current) => [...current, { ...EMPTY_STEP, relativeTo: "PREVIOUS" }])}
            >
              <Plus aria-hidden />
              Adicionar etapa
            </Button>
          </fieldset>

          <fieldset className="space-y-3">
            <legend className="mb-1 text-[0.8125rem] font-medium">Acompanhamento antes de cada retorno</legend>
            <p className="text-xs text-muted-foreground">
              Ex.: mensagem 30 e 7 dias antes, e tarefa de ligação no dia. Mensagens usam modelos aprovados pela Meta e só vão
              para quem autorizou; sem autorização, viram tarefa para a equipe. O convite é para agendar uma avaliação — a
              decisão clínica é da profissional. Mudanças valem para os próximos retornos programados.
            </p>
            {rulesError ? <p className="text-xs text-brick">{rulesError}</p> : null}
            <ol className="space-y-3">
              {rules.map((rule, index) => (
                <li key={index} className="space-y-3 rounded-xl border border-border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-muted-foreground">Regra {index + 1}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Remover regra ${index + 1}`}
                      onClick={() => setRules((current) => current.filter((_, position) => position !== index))}
                    >
                      <Trash2 aria-hidden />
                    </Button>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-[7rem_minmax(0,1fr)]">
                    <Input
                      aria-label={`Dias antes do retorno (regra ${index + 1})`}
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={365}
                      placeholder="Dias antes"
                      value={rule.daysBefore}
                      onChange={(event) => updateRule(index, { daysBefore: event.target.value })}
                    />
                    <FormSelect
                      id={`rule-action-${index}`}
                      name={`ruleAction${index}`}
                      value={rule.action}
                      options={ACTION_OPTIONS}
                      onValueChange={(value) => updateRule(index, { action: value as FollowUpAction })}
                    />
                  </div>
                  {rule.action === "MESSAGE" ? (
                    <FormSelect
                      id={`rule-template-${index}`}
                      name={`ruleTemplate${index}`}
                      value={rule.templateId}
                      options={templates}
                      placeholder={templates.length ? "Escolha o modelo da Meta" : "Cadastre um modelo em Assistente › Modelos"}
                      onValueChange={(value) => updateRule(index, { templateId: value })}
                    />
                  ) : (
                    <Input
                      aria-label={`Tarefa da equipe (regra ${index + 1})`}
                      placeholder="Ex.: Ligar para convidar para a reavaliação"
                      maxLength={120}
                      value={rule.taskTitle}
                      onChange={(event) => updateRule(index, { taskTitle: event.target.value })}
                    />
                  )}
                  <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                    <span>Aplica-se a:</span>
                    {STEP_KINDS.map((kind) => (
                      <label key={kind} className="flex items-center gap-1.5 text-foreground">
                        <Checkbox
                          checked={rule.stepKinds.includes(kind)}
                          onCheckedChange={(checked) =>
                            updateRule(index, {
                              stepKinds: checked ? [...rule.stepKinds, kind] : rule.stepKinds.filter((item) => item !== kind),
                            })
                          }
                        />
                        {PROTOCOL_STEP_KIND_LABELS[kind]}
                      </label>
                    ))}
                    <span>(nenhum marcado = todas as etapas)</span>
                  </div>
                </li>
              ))}
            </ol>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={rules.length >= 10}
              onClick={() => setRules((current) => [...current, { ...EMPTY_RULE }])}
            >
              <Plus aria-hidden />
              Adicionar regra de acompanhamento
            </Button>
          </fieldset>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Salvando…" : protocol ? "Salvar alterações" : "Cadastrar protocolo"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ProtocolActiveToggle({ protocolId, name, isActive }: { protocolId: string; name: string; isActive: boolean }) {
  const [open, setOpen] = useState(false);
  const { run, pending } = useAction(setProtocolActiveAction, { onSuccess: () => setOpen(false) });

  if (!isActive) {
    return (
      <Button variant="ghost" size="sm" disabled={pending} onClick={() => run(protocolId, true)}>
        Reativar
      </Button>
    );
  }
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Desativar
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`Desativar ${name}?`}
        description="O protocolo deixa de ser oferecido para novos pacientes. Protocolos já aplicados e seus retornos continuam como estão."
        confirmLabel="Desativar"
        pending={pending}
        onConfirm={() => run(protocolId, false)}
      />
    </>
  );
}
