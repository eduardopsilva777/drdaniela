/**
 * Posicionamento de atendimentos na grade da agenda. Itens que se sobrepõem
 * (ex.: duas profissionais no mesmo horário) ficam lado a lado; cada grupo de
 * sobreposição divide a largura do dia apenas entre os seus próprios itens.
 */

export interface TimedItem {
  id: string;
  /** Minutos desde a meia-noite local. */
  start: number;
  end: number;
}

export interface Placement {
  /** Coluna do item dentro do seu grupo (0 = mais à esquerda). */
  column: number;
  /** Total de colunas do grupo de sobreposição. */
  columns: number;
}

export function layoutDayItems(items: TimedItem[]): Map<string, Placement> {
  const placements = new Map<string, Placement>();
  const sorted = [...items].sort((a, b) => a.start - b.start || b.end - a.end);

  let cluster: Array<{ id: string; column: number }> = [];
  let columnEnds: number[] = [];
  let clusterEnd = -Infinity;

  const closeCluster = () => {
    for (const entry of cluster) placements.set(entry.id, { column: entry.column, columns: columnEnds.length });
    cluster = [];
    columnEnds = [];
    clusterEnd = -Infinity;
  };

  for (const item of sorted) {
    const end = Math.max(item.end, item.start + 1);
    if (item.start >= clusterEnd) closeCluster();
    let column = columnEnds.findIndex((columnEnd) => columnEnd <= item.start);
    if (column === -1) {
      column = columnEnds.length;
      columnEnds.push(end);
    } else {
      columnEnds[column] = end;
    }
    cluster.push({ id: item.id, column });
    clusterEnd = Math.max(clusterEnd, end);
  }
  closeCluster();
  return placements;
}

/** Faixa de horas exibida: o expediente padrão, ampliado se houver atendimento fora dele. */
export function visibleHourRange(
  items: Array<{ start: number; end: number }>,
  defaults: { startHour: number; endHour: number } = { startHour: 7, endHour: 21 },
): { startHour: number; endHour: number } {
  let startHour = defaults.startHour;
  let endHour = defaults.endHour;
  for (const item of items) {
    startHour = Math.min(startHour, Math.floor(item.start / 60));
    endHour = Math.max(endHour, Math.ceil(item.end / 60));
  }
  return { startHour: Math.max(0, startHour), endHour: Math.min(24, endHour) };
}
