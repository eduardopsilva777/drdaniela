"use client";

import { Check, ChevronsUpDown, LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { searchLeadsForSchedulingAction } from "@/server/actions/appointments";
import { searchPatientsAction } from "@/server/actions/patients";

export interface SubjectOption {
  id: string;
  fullName: string;
  phoneLabel: string;
}

/**
 * Busca de paciente ou lead com resultados do servidor (nome ou telefone).
 * Só lista pacientes ativos e leads que ainda podem ser agendados.
 */
export function SubjectPicker({
  id,
  kind,
  value,
  onChange,
  invalid,
  describedBy,
}: {
  id: string;
  kind: "patient" | "lead";
  value: SubjectOption | null;
  onChange: (value: SubjectOption | null) => void;
  invalid?: boolean;
  describedBy?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SubjectOption[]>([]);
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  function search(text: string) {
    setQuery(text);
    clearTimeout(timer.current);
    if (text.trim().length < 2) {
      setResults([]);
      return;
    }
    timer.current = setTimeout(() => {
      startTransition(async () => {
        const action = kind === "patient" ? searchPatientsAction : searchLeadsForSchedulingAction;
        const result = await action(text).catch(() => null);
        if (!result || !result.ok) {
          setError(result && !result.ok ? result.error : "Falha de conexão.");
          setResults([]);
          return;
        }
        setError(undefined);
        setResults(result.data);
      });
    }, 250);
  }

  const noun = kind === "patient" ? "paciente" : "lead";

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setQuery("");
          setResults([]);
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          className="h-9 w-full justify-between font-normal"
        >
          <span className={cn("truncate", !value && "text-muted-foreground")}>
            {value ? `${value.fullName} · ${value.phoneLabel}` : `Buscar ${noun} por nome ou telefone`}
          </span>
          <ChevronsUpDown aria-hidden className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) min-w-72 p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={`Nome ou telefone do ${noun}`}
            value={query}
            onValueChange={search}
            aria-label={`Buscar ${noun}`}
          />
          <CommandList>
            {pending ? (
              <div className="flex items-center gap-2 px-3 py-4 text-sm text-muted-foreground">
                <LoaderCircle aria-hidden className="size-4 animate-spin" />
                Buscando…
              </div>
            ) : null}
            {!pending ? (
              <CommandEmpty>
                {error ?? (query.trim().length < 2 ? "Digite ao menos 2 caracteres." : `Nenhum ${noun} encontrado.`)}
              </CommandEmpty>
            ) : null}
            {results.length > 0 ? (
              <CommandGroup>
                {results.map((option) => (
                  <CommandItem
                    key={option.id}
                    value={option.id}
                    onSelect={() => {
                      onChange(option);
                      setOpen(false);
                    }}
                  >
                    <Check aria-hidden className={cn("size-4", value?.id === option.id ? "opacity-100" : "opacity-0")} />
                    <span className="min-w-0 flex-1 truncate">{option.fullName}</span>
                    <span className="text-xs text-muted-foreground tabular-nums">{option.phoneLabel}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
