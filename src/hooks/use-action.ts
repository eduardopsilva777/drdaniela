"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import type { ActionResult, FieldErrors } from "@/lib/action-result";

interface UseActionOptions<TData> {
  /** Executado após sucesso (ex.: fechar o diálogo). */
  onSuccess?: (data: TData) => void;
  /** Mensagem de sucesso; usa a mensagem do servidor quando omitida. */
  successMessage?: string | false;
}

/**
 * Executa uma Server Action dentro de uma transição, expondo `pending`, erros de
 * campo e feedback por toast. Usado com `onSubmit` (e não `<form action>`) para
 * que os campos não sejam limpos quando a validação falha.
 */
export function useAction<TArgs extends unknown[], TData>(
  action: (...args: TArgs) => Promise<ActionResult<TData>>,
  options: UseActionOptions<TData> = {},
) {
  const [pending, startTransition] = useTransition();
  const [fieldErrors, setFieldErrors] = useState<FieldErrors | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [meta, setMeta] = useState<Record<string, string> | undefined>();

  function run(...args: TArgs) {
    startTransition(async () => {
      let result: ActionResult<TData> | undefined;
      try {
        result = await action(...args);
      } catch {
        result = { ok: false, error: "Falha de conexão com o servidor. Verifique a internet e tente de novo." };
      }
      // A action redirecionou (ex.: após a troca obrigatória de senha): nada a exibir.
      if (!result) return;

      if (result.ok) {
        setFieldErrors(undefined);
        setError(undefined);
        setMeta(undefined);
        const message = options.successMessage === false ? undefined : (options.successMessage ?? result.message);
        if (message) toast.success(message);
        options.onSuccess?.(result.data);
        return;
      }

      setFieldErrors(result.fieldErrors);
      setError(result.error);
      setMeta(result.meta);
      if (!result.fieldErrors) toast.error(result.error);
    });
  }

  function reset() {
    setFieldErrors(undefined);
    setError(undefined);
    setMeta(undefined);
  }

  return { run, pending, fieldErrors, error, meta, reset };
}
