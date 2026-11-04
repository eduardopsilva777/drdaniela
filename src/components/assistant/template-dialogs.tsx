"use client";

import { RefreshCw } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";

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
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { TemplateCategory, TemplateStatus, TemplateUsage } from "@/generated/prisma/enums";
import { useAction } from "@/hooks/use-action";
import { useResetOnHide } from "@/hooks/use-reset-on-hide";
import { firstFieldError } from "@/lib/action-result";
import {
  TEMPLATE_CATEGORY_LABELS,
  TEMPLATE_PARAMETER_LABELS,
  TEMPLATE_PARAMETERS,
  TEMPLATE_STATUS_LABELS,
  TEMPLATE_USAGE_LABELS,
  type TemplateParameter,
} from "@/lib/labels";
import { saveTemplateAction, setTemplateStatusAction, syncTemplatesAction } from "@/server/actions/assistant";

const options = <T extends string>(labels: Record<T, string>): SelectOption[] =>
  (Object.keys(labels) as T[]).map((value) => ({ value, label: labels[value] }));

const PARAMETER_OPTIONS = TEMPLATE_PARAMETERS.map((value) => ({ value, label: TEMPLATE_PARAMETER_LABELS[value] }));

export interface TemplateValues {
  id: string;
  name: string;
  language: string;
  category: TemplateCategory;
  usage: TemplateUsage;
  body: string;
  parameters: string[];
}

function placeholders(body: string): number {
  return new Set([...body.matchAll(/\{\{(\d+)\}\}/g)].map((match) => match[1])).size;
}

/** Cadastro do modelo como existe na Meta. Aprovar é na Meta; aqui se registra a situação. */
export function TemplateFormDialog({ template, trigger }: { template?: TemplateValues; trigger: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState(template?.body ?? "");
  const [parameters, setParameters] = useState<string[]>(template?.parameters ?? []);
  const action = saveTemplateAction.bind(null, template?.id ?? null);
  const { run, pending, fieldErrors, reset } = useAction(action, { onSuccess: () => setOpen(false) });
  useResetOnHide(() => setOpen(false));
  const error = (field: string) => firstFieldError(fieldErrors, field);
  const count = useMemo(() => placeholders(body), [body]);
  const prefix = template ? `template-${template.id}` : "template-new";

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setBody(template?.body ?? "");
          setParameters(template?.parameters ?? []);
        } else {
          reset();
        }
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{template ? "Editar modelo" : "Novo modelo de mensagem"}</DialogTitle>
          <DialogDescription>
            Cadastre aqui o mesmo nome, idioma e texto submetidos à Meta. Só modelos aprovados são enviados — e são os únicos
            permitidos fora da janela de 24 horas. Mudar nome ou idioma volta o modelo para rascunho.
          </DialogDescription>
        </DialogHeader>
        <form
          noValidate
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            data.set("parameters", JSON.stringify(parameters.slice(0, count)));
            run(data);
          }}
        >
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_8rem]">
            <FormField label="Nome na Meta" htmlFor={`${prefix}-name`} error={error("name")}>
              <Input {...fieldAria(`${prefix}-name`, error("name"))} name="name" defaultValue={template?.name} maxLength={512} placeholder="lembrete_retorno" />
            </FormField>
            <FormField label="Idioma" htmlFor={`${prefix}-language`} error={error("language")}>
              <Input {...fieldAria(`${prefix}-language`, error("language"))} name="language" defaultValue={template?.language ?? "pt_BR"} maxLength={15} />
            </FormField>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Categoria" htmlFor={`${prefix}-category`} error={error("category")}>
              <FormSelect id={`${prefix}-category`} name="category" defaultValue={template?.category ?? "UTILITY"} options={options(TEMPLATE_CATEGORY_LABELS)} />
            </FormField>
            <FormField label="Uso no CRM" htmlFor={`${prefix}-usage`} error={error("usage")}>
              <FormSelect id={`${prefix}-usage`} name="usage" defaultValue={template?.usage ?? "FOLLOW_UP"} options={options(TEMPLATE_USAGE_LABELS)} />
            </FormField>
          </div>
          <FormField
            label="Texto do modelo"
            htmlFor={`${prefix}-body`}
            error={error("body")}
            description="Igual ao aprovado na Meta, com {{1}}, {{2}}… onde entram os dados. Sem promessas de resultado nem orientação clínica."
          >
            <Textarea
              {...fieldAria(`${prefix}-body`, error("body"), true)}
              name="body"
              rows={4}
              maxLength={1024}
              value={body}
              onChange={(event) => setBody(event.target.value)}
            />
          </FormField>
          {count > 0 ? (
            <fieldset className="space-y-2">
              <legend className="text-[0.8125rem] font-medium">O que preenche cada marcador</legend>
              {error("parameters") ? <p className="text-xs text-brick">{error("parameters")}</p> : null}
              {Array.from({ length: count }, (_, index) => (
                <div key={index} className="grid grid-cols-[3rem_minmax(0,1fr)] items-center gap-3">
                  <span className="text-sm text-muted-foreground tabular-nums">{`{{${index + 1}}}`}</span>
                  <FormSelect
                    id={`${prefix}-param-${index}`}
                    name={`param${index}`}
                    value={parameters[index] ?? ""}
                    options={PARAMETER_OPTIONS}
                    placeholder="Escolha o dado"
                    onValueChange={(value) =>
                      setParameters((current) => {
                        const next = [...current];
                        next[index] = value as TemplateParameter;
                        return next;
                      })
                    }
                  />
                </div>
              ))}
            </fieldset>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Salvando…" : "Salvar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const STATUS_OPTIONS = options(TEMPLATE_STATUS_LABELS);

/** Registro manual da situação (quando não há sincronização/webhook da Meta). */
export function TemplateStatusDialog({ templateId, status, name }: { templateId: string; status: TemplateStatus; name: string }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState<string>(status);
  const action = setTemplateStatusAction.bind(null, templateId);
  const { run, pending } = useAction(action, { onSuccess: () => setOpen(false) });
  useResetOnHide(() => setOpen(false));
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setValue(status);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">
          Situação
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Situação de {name}</DialogTitle>
          <DialogDescription>
            Registre exatamente o que aparece no painel da Meta. Marcar como aprovado um modelo que não foi aprovado faz os
            envios falharem.
          </DialogDescription>
        </DialogHeader>
        <form
          noValidate
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            run(new FormData(event.currentTarget));
          }}
        >
          <FormField label="Situação na Meta" htmlFor={`status-${templateId}`}>
            <FormSelect id={`status-${templateId}`} name="status" value={value} options={STATUS_OPTIONS} onValueChange={setValue} />
          </FormField>
          {value === "REJECTED" ? (
            <FormField label="Motivo informado pela Meta" htmlFor={`status-reason-${templateId}`} optional>
              <Input id={`status-reason-${templateId}`} name="reason" maxLength={300} />
            </FormField>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Salvando…" : "Salvar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function SyncTemplatesButton() {
  const { run, pending } = useAction(syncTemplatesAction, {
    successMessage: false,
    onSuccess: (data) => toast.success(`Meta consultada: ${data.received} modelo(s), ${data.updated} atualizado(s) no CRM.`),
  });
  return (
    <Button variant="outline" disabled={pending} onClick={() => run()}>
      <RefreshCw aria-hidden className={pending ? "animate-spin" : undefined} />
      {pending ? "Consultando…" : "Sincronizar com a Meta"}
    </Button>
  );
}
