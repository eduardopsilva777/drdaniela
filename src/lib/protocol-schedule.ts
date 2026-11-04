import { addDaysToKey, type DateKey } from "@/lib/datetime";

/**
 * Cálculo das datas de um protocolo a partir dos intervalos definidos pela
 * profissional. Não há nenhuma regra clínica aqui: apenas aritmética de datas.
 *
 * - Etapa "após o início": data = início + intervalo.
 * - Etapa "após a etapa anterior": data = data da etapa anterior + intervalo.
 */

export interface StepDefinition {
  id: string;
  position: number;
  offsetDays: number;
  relativeTo: "START" | "PREVIOUS";
}

export function computeStepDueDates(startKey: DateKey, steps: StepDefinition[]): Map<string, DateKey> {
  const dues = new Map<string, DateKey>();
  let previous = startKey;
  for (const step of [...steps].sort((a, b) => a.position - b.position)) {
    const base = step.relativeTo === "START" ? startKey : previous;
    const due = addDaysToKey(base, step.offsetDays);
    dues.set(step.id, due);
    previous = due;
  }
  return dues;
}

export interface ScheduledStep extends StepDefinition {
  /** Data prevista atual do retorno desta etapa. */
  dueKey: DateKey;
  /** Só retornos ainda pendentes podem ter a data recalculada. */
  adjustable: boolean;
}

/**
 * Quando uma etapa é realizada numa data diferente da prevista, as etapas
 * seguintes encadeadas ("após a etapa anterior") são recalculadas a partir da
 * data real. Retorna apenas as etapas cuja data mudou.
 */
export function recomputeAfterCompletion(
  steps: ScheduledStep[],
  completedStepId: string,
  completedOnKey: DateKey,
): Map<string, DateKey> {
  const ordered = [...steps].sort((a, b) => a.position - b.position);
  const index = ordered.findIndex((step) => step.id === completedStepId);
  const changes = new Map<string, DateKey>();
  if (index === -1) return changes;

  let previous = completedOnKey;
  for (const step of ordered.slice(index + 1)) {
    if (step.relativeTo === "START") {
      previous = step.dueKey;
      continue;
    }
    const nextDue = addDaysToKey(previous, step.offsetDays);
    if (step.adjustable && nextDue !== step.dueKey) {
      changes.set(step.id, nextDue);
      previous = nextDue;
    } else {
      previous = step.dueKey;
    }
  }
  return changes;
}
