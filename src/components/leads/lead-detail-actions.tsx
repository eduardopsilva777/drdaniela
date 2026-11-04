"use client";

import { ChevronDown, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ConfirmDialog } from "@/components/forms/confirm-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAction } from "@/hooks/use-action";
import { useResetOnHide } from "@/hooks/use-reset-on-hide";
import { LEAD_STATUS_LABELS, LEAD_STATUS_ORDER } from "@/lib/labels";
import { deleteLeadAction } from "@/server/actions/leads";

import { useLeadMoves, type MovableLead } from "./use-lead-moves";

export function LeadStageMenu({ lead }: { lead: MovableLead }) {
  const { requestMove, dialogs, pending, reset } = useLeadMoves();
  useResetOnHide(reset);

  if (lead.status === "CONVERTED") return null;

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" disabled={pending}>
            Mudar etapa
            <ChevronDown aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-48">
          {LEAD_STATUS_ORDER.filter((status) => status !== lead.status).map((status) => (
            <DropdownMenuItem key={status} onSelect={() => requestMove(lead, status)}>
              {status === "CONVERTED" ? "Converter em paciente" : LEAD_STATUS_LABELS[status]}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {dialogs}
    </>
  );
}

export function DeleteLeadButton({ leadId, leadName }: { leadId: string; leadName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { run, pending } = useAction(deleteLeadAction, {
    onSuccess: () => {
      setOpen(false);
      router.replace("/leads");
    },
  });
  useResetOnHide(() => setOpen(false));

  return (
    <>
      <Button variant="ghost" className="text-brick hover:text-brick" onClick={() => setOpen(true)}>
        <Trash2 aria-hidden />
        Excluir
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        destructive
        pending={pending}
        title={`Excluir ${leadName}?`}
        description="Use para atender a um pedido de eliminação de dados (LGPD). O lead e todo o histórico de interações são apagados de forma definitiva. Para apenas tirar do funil, marque como perdido."
        confirmLabel="Excluir definitivamente"
        onConfirm={() => run(leadId)}
      />
    </>
  );
}
