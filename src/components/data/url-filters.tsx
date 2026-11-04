"use client";

import { LoaderCircle, Search, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

/**
 * Filtros guardados na URL: a lista é renderizada no servidor a partir da query
 * string, o estado sobrevive a recarregamentos e pode ser compartilhado.
 */
function useUrlParams() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  function update(changes: Record<string, string | null>) {
    const next = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === "") next.delete(key);
      else next.set(key, value);
    }
    next.delete("pagina"); // mudar filtro volta para a primeira página
    const query = next.toString();
    startTransition(() => {
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    });
  }

  return { searchParams, update, pending };
}

export function SearchFilter({
  param = "busca",
  placeholder,
  label,
  className,
}: {
  param?: string;
  placeholder: string;
  label: string;
  className?: string;
}) {
  const { searchParams, update, pending } = useUrlParams();
  const current = searchParams.get(param) ?? "";
  const [value, setValue] = useState(current);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  function onChange(next: string) {
    setValue(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => update({ [param]: next.trim() || null }), 350);
  }

  return (
    <div className={cn("relative min-w-0", className)}>
      <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        aria-label={label}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 pr-9 pl-9"
        maxLength={80}
      />
      {pending ? (
        <LoaderCircle aria-hidden className="absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
      ) : value ? (
        <button
          type="button"
          aria-label="Limpar busca"
          onClick={() => onChange("")}
          className="absolute top-1/2 right-2 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
        >
          <X aria-hidden className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}

export interface FilterOption {
  value: string;
  label: string;
}

const ALL = "__all";

export function SelectFilter({
  param,
  label,
  allLabel,
  options,
  className,
}: {
  param: string;
  label: string;
  allLabel: string;
  options: FilterOption[];
  className?: string;
}) {
  const { searchParams, update } = useUrlParams();
  const current = searchParams.get(param) ?? ALL;

  return (
    <Select value={current} onValueChange={(value) => update({ [param]: value === ALL ? null : value })}>
      <SelectTrigger aria-label={label} className={cn("h-9 min-w-36", className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{allLabel}</SelectItem>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Alterna entre valores fixos (ex.: visão Funil/Lista) via URL. */
export function SegmentedFilter({
  param,
  label,
  options,
  defaultValue,
}: {
  param: string;
  label: string;
  options: FilterOption[];
  defaultValue: string;
}) {
  const { searchParams, update } = useUrlParams();
  const current = searchParams.get(param) ?? defaultValue;

  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg border border-border bg-card p-0.5">
      {options.map((option) => {
        const active = option.value === current;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => update({ [param]: option.value === defaultValue ? null : option.value })}
            className={cn(
              "h-8 rounded-md px-3 text-sm transition-colors",
              active ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
