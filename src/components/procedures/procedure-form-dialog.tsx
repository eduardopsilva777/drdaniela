"use client";

import { useState, type ReactNode } from "react";

import { fieldAria, FormField } from "@/components/forms/form-field";
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
import { useAction } from "@/hooks/use-action";
import { useResetOnHide } from "@/hooks/use-reset-on-hide";
import { firstFieldError } from "@/lib/action-result";
import { centsToInput } from "@/lib/money";
import { cn } from "@/lib/utils";
import { saveProcedureAction } from "@/server/actions/procedures";

/** Cores harmonizadas com a paleta, para a agenda continuar legível e coerente. */
export const PROCEDURE_COLORS = [
  { value: "#e8abb1", label: "Rosé" },
  { value: "#e3caa4", label: "Champanhe" },
  { value: "#bbabdb", label: "Lavanda" },
  { value: "#96c8aa", label: "Sálvia" },
  { value: "#9cc3de", label: "Céu" },
  { value: "#d9a77e", label: "Areia" },
  { value: "#c9a0b4", label: "Malva" },
  { value: "#e47c72", label: "Terracota" },
];

export interface ProcedureFormValues {
  id: string;
  name: string;
  category: string | null;
  description: string | null;
  durationMinutes: number;
  priceCents: number | null;
  suggestedReturnDays: number | null;
  color: string | null;
}

export function ProcedureFormDialog({
  procedure,
  trigger,
}: {
  procedure?: ProcedureFormValues;
  trigger: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const action = saveProcedureAction.bind(null, procedure?.id ?? null);
  const { run, pending, fieldErrors, reset } = useAction(action, { onSuccess: () => setOpen(false) });
  useResetOnHide(() => setOpen(false));

  const error = (field: string) => firstFieldError(fieldErrors, field);
  const [color, setColor] = useState(procedure?.color ?? "");

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setColor(procedure?.color ?? "");
        else reset();
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{procedure ? "Editar procedimento" : "Novo procedimento"}</DialogTitle>
          <DialogDescription>
            A duração é usada como padrão na agenda. O intervalo de retorno é definido pela profissional.
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
          <FormField label="Nome" htmlFor="procedure-name" error={error("name")}>
            <Input
              {...fieldAria("procedure-name", error("name"))}
              name="name"
              defaultValue={procedure?.name}
              maxLength={120}
              required
              autoFocus
            />
          </FormField>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Categoria" htmlFor="procedure-category" optional error={error("category")}>
              <Input
                {...fieldAria("procedure-category", error("category"))}
                name="category"
                defaultValue={procedure?.category ?? ""}
                placeholder="Ex.: Injetáveis"
                maxLength={60}
              />
            </FormField>
            <FormField label="Duração (minutos)" htmlFor="procedure-duration" error={error("durationMinutes")}>
              <Input
                {...fieldAria("procedure-duration", error("durationMinutes"))}
                name="durationMinutes"
                type="number"
                inputMode="numeric"
                min={5}
                max={720}
                step={5}
                defaultValue={procedure?.durationMinutes ?? 60}
                required
              />
            </FormField>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Preço de referência" htmlFor="procedure-price" optional error={error("price")}>
              <Input
                {...fieldAria("procedure-price", error("price"))}
                name="price"
                inputMode="decimal"
                placeholder="Ex.: 350,00"
                defaultValue={centsToInput(procedure?.priceCents)}
                maxLength={16}
              />
            </FormField>
            <FormField
              label="Retorno sugerido (dias)"
              htmlFor="procedure-return"
              optional
              error={error("suggestedReturnDays")}
              description="Definido pela profissional."
            >
              <Input
                {...fieldAria("procedure-return", error("suggestedReturnDays"), true)}
                name="suggestedReturnDays"
                type="number"
                inputMode="numeric"
                min={1}
                max={3650}
                defaultValue={procedure?.suggestedReturnDays ?? ""}
              />
            </FormField>
          </div>

          <FormField label="Descrição" htmlFor="procedure-description" optional error={error("description")}>
            <Textarea
              {...fieldAria("procedure-description", error("description"))}
              name="description"
              rows={3}
              maxLength={500}
              defaultValue={procedure?.description ?? ""}
              placeholder="Descrição administrativa do serviço (sem orientações clínicas)."
            />
          </FormField>

          <fieldset className="space-y-2">
            <legend className="text-[0.8125rem] font-medium">
              Cor na agenda <span className="font-normal text-muted-foreground">(opcional)</span>
            </legend>
            <input type="hidden" name="color" value={color} />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setColor("")}
                aria-pressed={color === ""}
                className={cn(
                  "h-8 rounded-full border border-border px-3 text-xs text-muted-foreground transition-colors",
                  color === "" && "border-primary/60 text-foreground",
                )}
              >
                Sem cor
              </button>
              {PROCEDURE_COLORS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setColor(option.value)}
                  aria-pressed={color === option.value}
                  aria-label={option.label}
                  title={option.label}
                  className={cn(
                    "size-8 rounded-full border-2 border-transparent ring-offset-2 ring-offset-popover transition-[box-shadow]",
                    color === option.value && "ring-2 ring-foreground/70",
                  )}
                  style={{ backgroundColor: option.value }}
                />
              ))}
            </div>
          </fieldset>

          <DialogFooter className="pt-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Salvando…" : procedure ? "Salvar alterações" : "Cadastrar procedimento"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
