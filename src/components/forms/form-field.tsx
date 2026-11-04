import type { ReactNode } from "react";

import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { cn } from "@/lib/utils";

/**
 * Campo de formulário acessível: rótulo associado, descrição e erro ligados ao
 * controle por `aria-describedby` (o controle recebe `id` = `htmlFor`).
 */
export function FormField({
  label,
  htmlFor,
  error,
  description,
  optional,
  className,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  description?: ReactNode;
  optional?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Field data-invalid={error ? true : undefined} className={cn("gap-1.5", className)}>
      <FieldLabel htmlFor={htmlFor} className="text-[0.8125rem]">
        {label}
        {optional ? <span className="font-normal text-muted-foreground">(opcional)</span> : null}
      </FieldLabel>
      {children}
      {description && !error ? (
        <FieldDescription id={`${htmlFor}-description`} className="text-xs">
          {description}
        </FieldDescription>
      ) : null}
      {error ? <FieldError id={`${htmlFor}-error`} errors={[{ message: error }]} className="text-xs" /> : null}
    </Field>
  );
}

/** Atributos ARIA para o controle dentro de um FormField. */
export function fieldAria(htmlFor: string, error?: string, hasDescription = false) {
  const describedBy = error ? `${htmlFor}-error` : hasDescription ? `${htmlFor}-description` : undefined;
  return {
    id: htmlFor,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": describedBy,
  } as const;
}
