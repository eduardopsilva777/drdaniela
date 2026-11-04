"use client";

import { Lock } from "lucide-react";
import { useRef, useState } from "react";

import { fieldAria, FormField } from "@/components/forms/form-field";
import { StatusBadge } from "@/components/ui-kit/status-badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/hooks/use-action";
import { firstFieldError } from "@/lib/action-result";
import { NOTE_VISIBILITY_LABELS } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { addPatientNoteAction } from "@/server/actions/patients";

export function PatientNoteForm({ patientId, canWriteClinical }: { patientId: string; canWriteClinical: boolean }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [visibility, setVisibility] = useState<"CLINICAL" | "ADMINISTRATIVE">(canWriteClinical ? "CLINICAL" : "ADMINISTRATIVE");
  const { run, pending, fieldErrors } = useAction(addPatientNoteAction.bind(null, patientId), {
    onSuccess: () => formRef.current?.reset(),
  });
  const error = firstFieldError(fieldErrors, "content");

  return (
    <form
      ref={formRef}
      noValidate
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        data.set("visibility", visibility);
        run(data);
      }}
    >
      {canWriteClinical ? (
        <div role="radiogroup" aria-label="Visibilidade da observação" className="flex flex-wrap gap-1.5">
          {(["CLINICAL", "ADMINISTRATIVE"] as const).map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={visibility === option}
              onClick={() => setVisibility(option)}
              className={cn(
                "h-8 rounded-full border border-border px-3 text-xs transition-colors",
                visibility === option ? "border-primary/60 bg-primary-subtle font-semibold text-primary-subtle-foreground" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {NOTE_VISIBILITY_LABELS[option]}
            </button>
          ))}
        </div>
      ) : null}
      <FormField
        label="Observação"
        htmlFor="note-content"
        error={error}
        description={
          visibility === "CLINICAL"
            ? "Visível apenas para profissionais e administração. Cada leitura é registrada."
            : "Visível para toda a equipe (ex.: preferências de horário). Não inclua informações de saúde."
        }
      >
        <Textarea {...fieldAria("note-content", error, true)} name="content" rows={4} maxLength={4000} />
      </FormField>
      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? "Salvando…" : "Salvar observação"}
        </Button>
      </div>
    </form>
  );
}

export interface NoteItem {
  id: string;
  visibility: "CLINICAL" | "ADMINISTRATIVE";
  content: string;
  readable: boolean;
  authorName: string;
  createdAtLabel: string;
}

export function PatientNoteList({ notes }: { notes: NoteItem[] }) {
  if (notes.length === 0) {
    return <p className="text-sm text-muted-foreground">Nenhuma observação registrada.</p>;
  }
  return (
    <ul className="space-y-4">
      {notes.map((note) => (
        <li key={note.id} className="rounded-xl border border-border p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <StatusBadge
              tone={note.visibility === "CLINICAL" ? "primary" : "neutral"}
              label={NOTE_VISIBILITY_LABELS[note.visibility]}
            />
            <span className="text-xs text-muted-foreground tabular-nums">
              {note.createdAtLabel} por {note.authorName}
            </span>
          </div>
          <p className={cn("mt-3 text-sm leading-relaxed whitespace-pre-line", !note.readable && "text-destructive")}>
            {!note.readable ? <Lock aria-hidden className="mr-1.5 inline size-3.5" /> : null}
            {note.content}
          </p>
        </li>
      ))}
    </ul>
  );
}
