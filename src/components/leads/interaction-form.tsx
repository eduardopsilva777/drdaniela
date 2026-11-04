"use client";

import { useRef, useState } from "react";

import { fieldAria, FormField } from "@/components/forms/form-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/hooks/use-action";
import { firstFieldError, type ActionResult } from "@/lib/action-result";
import { INTERACTION_TYPE_LABELS } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { MANUAL_INTERACTION_TYPE_VALUES } from "@/lib/validation/leads";

const TYPES = MANUAL_INTERACTION_TYPE_VALUES;

/**
 * Registro de interação (ligação, mensagem, e-mail, atendimento, nota) com
 * agendamento opcional do próximo contato. Serve a leads e a pacientes.
 */
export function InteractionForm({
  action,
  showNextAction = true,
}: {
  action: (formData: FormData) => Promise<ActionResult<null>>;
  showNextAction?: boolean;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [type, setType] = useState<(typeof TYPES)[number]>("CALL");
  const [direction, setDirection] = useState<"OUTBOUND" | "INBOUND">("OUTBOUND");
  const [customTime, setCustomTime] = useState(false);
  const { run, pending, fieldErrors } = useAction(action, {
    onSuccess: () => {
      formRef.current?.reset();
      setCustomTime(false);
    },
  });
  const error = (field: string) => firstFieldError(fieldErrors, field);

  return (
    <form
      ref={formRef}
      noValidate
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        data.set("type", type);
        if (type !== "NOTE") data.set("direction", direction);
        run(data);
      }}
    >
      <div role="radiogroup" aria-label="Tipo de interação" className="flex flex-wrap gap-1.5">
        {TYPES.map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={type === option}
            onClick={() => setType(option)}
            className={cn(
              "h-8 rounded-full border border-border px-3 text-xs transition-colors",
              type === option ? "border-rose/60 bg-rose/10 text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {INTERACTION_TYPE_LABELS[option]}
          </button>
        ))}
      </div>

      {type !== "NOTE" && type !== "IN_PERSON" ? (
        <div role="radiogroup" aria-label="Quem iniciou o contato" className="flex flex-wrap gap-4 text-sm">
          {(["OUTBOUND", "INBOUND"] as const).map((option) => (
            <label key={option} className="flex items-center gap-2 text-muted-foreground">
              <input
                type="radio"
                name="directionChoice"
                className="accent-[var(--rose)]"
                checked={direction === option}
                onChange={() => setDirection(option)}
              />
              {option === "OUTBOUND" ? "A clínica fez o contato" : "O contato procurou a clínica"}
            </label>
          ))}
        </div>
      ) : null}

      <FormField label="O que aconteceu" htmlFor="interaction-content" error={error("content")}>
        <Textarea
          {...fieldAria("interaction-content", error("content"))}
          name="content"
          rows={3}
          maxLength={2000}
          placeholder="Resumo objetivo, sem informações clínicas."
        />
      </FormField>

      {customTime ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField label="Data em que ocorreu" htmlFor="interaction-date" error={error("occurredDate")}>
            <Input {...fieldAria("interaction-date", error("occurredDate"))} name="occurredDate" type="date" />
          </FormField>
          <FormField label="Horário" htmlFor="interaction-time" optional error={error("occurredTime")}>
            <Input {...fieldAria("interaction-time", error("occurredTime"))} name="occurredTime" type="time" />
          </FormField>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setCustomTime(true)}
          className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
        >
          Aconteceu em outro momento? Informar data
        </button>
      )}

      {showNextAction ? (
        <fieldset className="space-y-3 rounded-xl border border-border p-4">
          <legend className="px-1 text-[0.8125rem] font-medium">
            Próximo contato <span className="font-normal text-muted-foreground">(opcional)</span>
          </legend>
          <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
            <FormField label="Data" htmlFor="interaction-next-date" error={error("nextActionDate")}>
              <Input {...fieldAria("interaction-next-date", error("nextActionDate"))} name="nextActionDate" type="date" />
            </FormField>
            <FormField label="Horário" htmlFor="interaction-next-time" error={error("nextActionTime")}>
              <Input {...fieldAria("interaction-next-time", error("nextActionTime"))} name="nextActionTime" type="time" />
            </FormField>
          </div>
          <FormField label="O que fazer" htmlFor="interaction-next-note" error={error("nextActionNote")}>
            <Input
              {...fieldAria("interaction-next-note", error("nextActionNote"))}
              name="nextActionNote"
              maxLength={200}
              placeholder="Ex.: retornar com a disponibilidade da agenda"
            />
          </FormField>
          <p className="text-xs text-muted-foreground">
            Registrar um contato conclui a próxima ação pendente; preencha aqui se houver um novo passo.
          </p>
        </fieldset>
      ) : null}

      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? "Registrando…" : "Registrar interação"}
        </Button>
      </div>
    </form>
  );
}
