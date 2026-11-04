import { describe, expect, it } from "vitest";

import { layoutDayItems, visibleHourRange } from "@/lib/agenda-layout";

const at = (hour: number, minute = 0) => hour * 60 + minute;

describe("posicionamento na grade da agenda", () => {
  it("itens sem sobreposição ocupam a largura toda", () => {
    const layout = layoutDayItems([
      { id: "a", start: at(9), end: at(10) },
      { id: "b", start: at(10), end: at(11) }, // encostado: não sobrepõe
    ]);
    expect(layout.get("a")).toEqual({ column: 0, columns: 1 });
    expect(layout.get("b")).toEqual({ column: 0, columns: 1 });
  });

  it("itens sobrepostos ficam lado a lado e reaproveitam colunas livres", () => {
    const layout = layoutDayItems([
      { id: "a", start: at(9), end: at(11) },
      { id: "b", start: at(9, 30), end: at(10) },
      { id: "c", start: at(10), end: at(10, 30) },
      { id: "d", start: at(14), end: at(15) },
    ]);
    expect(layout.get("a")).toEqual({ column: 0, columns: 2 });
    expect(layout.get("b")).toEqual({ column: 1, columns: 2 });
    expect(layout.get("c")).toEqual({ column: 1, columns: 2 });
    expect(layout.get("d")).toEqual({ column: 0, columns: 1 });
  });

  it("três horários simultâneos dividem a largura em três", () => {
    const layout = layoutDayItems([
      { id: "a", start: at(9), end: at(10) },
      { id: "b", start: at(9), end: at(10) },
      { id: "c", start: at(9, 15), end: at(9, 45) },
    ]);
    expect([...layout.values()].map((placement) => placement.columns)).toEqual([3, 3, 3]);
    expect(new Set([...layout.values()].map((placement) => placement.column)).size).toBe(3);
  });

  it("amplia a faixa de horas para mostrar atendimentos fora do expediente padrão", () => {
    expect(visibleHourRange([])).toEqual({ startHour: 7, endHour: 21 });
    expect(visibleHourRange([{ start: at(6, 30), end: at(7, 30) }, { start: at(21), end: at(22, 15) }])).toEqual({
      startHour: 6,
      endHour: 23,
    });
  });
});
