"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import type { LeadStatus } from "@/generated/prisma/enums";
import { changeLeadStatusAction, getConversionMatchesAction } from "@/server/actions/leads";

import { ConvertLeadDialog, type ConvertibleLead, type PatientMatch } from "./convert-lead-dialog";
import { LostReasonDialog } from "./lost-reason-dialog";

export interface MovableLead extends ConvertibleLead {
  status: LeadStatus;
}

/**
 * Regras de interface para mudar a etapa de um lead (usado pelo quadro e pela
 * página do lead): "Perdido" pede o motivo; "Convertido" abre a conversão em
 * paciente; as demais etapas são salvas imediatamente.
 */
export function useLeadMoves(options: { onOptimisticMove?: (leadId: string, to: LeadStatus) => void } = {}) {
  const [pending, startTransition] = useTransition();
  const [lostTarget, setLostTarget] = useState<MovableLead | null>(null);
  const [conversion, setConversion] = useState<{ lead: MovableLead; matches: PatientMatch[] } | null>(null);

  function save(lead: MovableLead, to: LeadStatus, lostReason?: string) {
    startTransition(async () => {
      options.onOptimisticMove?.(lead.id, to);
      try {
        const result = await changeLeadStatusAction({ leadId: lead.id, status: to, lostReason });
        if (result.ok) {
          toast.success(result.message ?? "Etapa atualizada.");
          setLostTarget(null);
        } else {
          toast.error(result.error);
        }
      } catch {
        toast.error("Falha de conexão. A etapa não foi alterada.");
      }
    });
  }

  function requestMove(lead: MovableLead, to: LeadStatus) {
    if (lead.status === to) return;
    if (lead.status === "CONVERTED") {
      toast.error("Este lead já é paciente e não volta para o funil.");
      return;
    }
    if (to === "LOST") {
      setLostTarget(lead);
      return;
    }
    if (to === "CONVERTED") {
      startTransition(async () => {
        const result = await getConversionMatchesAction(lead.id);
        if (!result.ok) {
          toast.error(result.error);
          return;
        }
        setConversion({ lead, matches: result.data });
      });
      return;
    }
    save(lead, to);
  }

  const dialogs = (
    <>
      {lostTarget ? (
        <LostReasonDialog
          leadName={lostTarget.name}
          open
          pending={pending}
          onOpenChange={(open) => {
            if (!open) setLostTarget(null);
          }}
          onConfirm={(reason) => save(lostTarget, "LOST", reason)}
        />
      ) : null}
      {conversion ? (
        <ConvertLeadDialog
          key={conversion.lead.id}
          lead={conversion.lead}
          matches={conversion.matches}
          open
          onOpenChange={(open) => {
            if (!open) setConversion(null);
          }}
        />
      ) : null}
    </>
  );

  return { requestMove, dialogs, pending, reset: () => { setLostTarget(null); setConversion(null); } };
}
