"use client";

import { Check, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useAction } from "@/hooks/use-action";
import { cancelTaskAction, completeTaskAction } from "@/server/actions/assistant";

export function TaskActions({ taskId }: { taskId: string }) {
  const complete = useAction(completeTaskAction);
  const cancel = useAction(cancelTaskAction);
  const pending = complete.pending || cancel.pending;
  return (
    <div className="flex gap-1">
      <Button size="sm" variant="outline" disabled={pending} onClick={() => complete.run(taskId)}>
        <Check aria-hidden />
        Concluir
      </Button>
      <Button size="sm" variant="ghost" disabled={pending} onClick={() => cancel.run(taskId)} aria-label="Cancelar tarefa">
        <X aria-hidden />
      </Button>
    </div>
  );
}
