"use client";

import { useState } from "react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const NONE = "__none";

export interface SelectOption {
  value: string;
  label: string;
}

/**
 * Select para formulários enviados como FormData. Mantém o valor num campo
 * oculto (o Radix não aceita valor vazio, e "nenhum" precisa chegar como "").
 * Funciona controlado (`value`) ou não controlado (`defaultValue`).
 */
export function FormSelect({
  id,
  name,
  options,
  defaultValue,
  value: controlledValue,
  placeholder = "Selecione",
  emptyLabel,
  invalid,
  describedBy,
  onValueChange,
  disabled,
}: {
  id: string;
  name: string;
  options: SelectOption[];
  defaultValue?: string | null;
  /** Valor controlado ("" = nenhum). */
  value?: string;
  placeholder?: string;
  /** Quando informado, oferece a opção "nenhum" com este rótulo. */
  emptyLabel?: string;
  invalid?: boolean;
  describedBy?: string;
  onValueChange?: (value: string) => void;
  disabled?: boolean;
}) {
  const [internal, setInternal] = useState<string>(defaultValue || (emptyLabel ? NONE : ""));
  const value = controlledValue !== undefined ? controlledValue || (emptyLabel ? NONE : "") : internal;

  return (
    <>
      <input type="hidden" name={name} value={value === NONE ? "" : value} />
      <Select
        value={value || undefined}
        disabled={disabled}
        onValueChange={(next) => {
          if (controlledValue === undefined) setInternal(next);
          onValueChange?.(next === NONE ? "" : next);
        }}
      >
        <SelectTrigger
          id={id}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          className="w-full"
        >
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {emptyLabel ? <SelectItem value={NONE}>{emptyLabel}</SelectItem> : null}
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </>
  );
}
