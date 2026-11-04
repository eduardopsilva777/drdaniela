import { describe, expect, it } from "vitest";

import {
  addDaysToKey,
  addMonthsToKey,
  ageOn,
  dateKeyOf,
  dayRange,
  diffInDays,
  isDateKey,
  minutesOfDay,
  monthGridRange,
  timeOf,
  weekRange,
  zonedDateTime,
} from "@/lib/datetime";
import { centsToInput, formatBRL, parseMoneyToCents } from "@/lib/money";
import { formatPhone, normalizePhone, phoneDigits, whatsappLink } from "@/lib/phone";
import { computeStepDueDates, recomputeAfterCompletion } from "@/lib/protocol-schedule";
import { describeDue, describeDueDateKey } from "@/lib/relative-dates";

const TZ = "America/Sao_Paulo";

describe("telefones", () => {
  it("normaliza números brasileiros em E.164 a partir de vários formatos", () => {
    expect(normalizePhone("(11) 98765-4321")).toBe("+5511987654321");
    expect(normalizePhone("11987654321")).toBe("+5511987654321");
    expect(normalizePhone("+55 11 98765 4321")).toBe("+5511987654321");
    expect(normalizePhone("(11) 3456-7890")).toBe("+551134567890");
    expect(normalizePhone("+1 202 555 0143")).toBe("+12025550143");
  });

  it("rejeita números inválidos ou incompletos", () => {
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone("12345")).toBeNull();
    expect(normalizePhone("(00) 0000-0000")).toBeNull();
    expect(normalizePhone("x".repeat(40))).toBeNull();
  });

  it("formata para exibição e gera link do WhatsApp", () => {
    expect(formatPhone("+5511987654321")).toBe("(11) 98765-4321");
    expect(phoneDigits("(11) 98765-4321")).toBe("11987654321");
    expect(whatsappLink("+5511987654321")).toBe("https://wa.me/5511987654321");
  });
});

describe("valores monetários (centavos)", () => {
  it("interpreta o que a equipe digita", () => {
    expect(parseMoneyToCents("R$ 1.250,00")).toBe(125000);
    expect(parseMoneyToCents("1250")).toBe(125000);
    expect(parseMoneyToCents("1.250")).toBe(125000);
    expect(parseMoneyToCents("350,5")).toBe(35050);
    expect(parseMoneyToCents("99.90")).toBe(9990);
  });

  it("rejeita valores inválidos", () => {
    expect(parseMoneyToCents("")).toBeNull();
    expect(parseMoneyToCents("abc")).toBeNull();
    expect(parseMoneyToCents("-10")).toBeNull();
    expect(parseMoneyToCents("1,234,56")).toBeNull();
  });

  it("formata em reais e para campos de formulário", () => {
    expect(formatBRL(125000)).toMatch(/R\$\s1\.250,00/);
    expect(centsToInput(35050)).toBe("350,50");
    expect(centsToInput(null)).toBe("");
  });
});

describe("datas no fuso da clínica", () => {
  it("converte data e hora locais de São Paulo em UTC (UTC−3, sem horário de verão)", () => {
    expect(zonedDateTime("2026-11-04", "09:00", TZ).toISOString()).toBe("2026-11-04T12:00:00.000Z");
    expect(zonedDateTime("2026-01-15", "23:30", TZ).toISOString()).toBe("2026-01-16T02:30:00.000Z");
  });

  it("obtém a data e o horário locais de um instante", () => {
    const lateNight = new Date("2026-11-05T02:30:00.000Z"); // 23:30 do dia 04 em São Paulo
    expect(dateKeyOf(lateNight, TZ)).toBe("2026-11-04");
    expect(timeOf(lateNight, TZ)).toBe("23:30");
    expect(minutesOfDay(lateNight, TZ)).toBe(23 * 60 + 30);
  });

  it("faz aritmética de calendário sem depender do fuso", () => {
    expect(addDaysToKey("2026-12-30", 3)).toBe("2027-01-02");
    expect(addMonthsToKey("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsToKey("2028-01-31", 1)).toBe("2028-02-29");
    expect(diffInDays("2026-11-02", "2026-12-02")).toBe(30);
    expect(isDateKey("2026-02-30")).toBe(false);
    expect(isDateKey("2026-02-28")).toBe(true);
  });

  it("monta intervalos de dia, semana (segunda a domingo) e grade do mês", () => {
    const day = dayRange("2026-11-04", TZ);
    expect(day.start.toISOString()).toBe("2026-11-04T03:00:00.000Z");
    expect(day.end.toISOString()).toBe("2026-11-05T03:00:00.000Z");

    const week = weekRange("2026-11-04", TZ);
    expect(week.days[0]).toBe("2026-11-02");
    expect(week.days).toHaveLength(7);

    const month = monthGridRange("2026-11-15", TZ);
    expect(month.days[0]).toBe("2026-10-26");
    expect(month.days.at(-1)).toBe("2026-12-06");
    expect(month.days.length % 7).toBe(0);
  });

  it("calcula a idade em anos completos", () => {
    expect(ageOn("1990-11-02", "2026-11-01")).toBe(35);
    expect(ageOn("1990-11-02", "2026-11-02")).toBe(36);
  });
});

describe("prazos legíveis", () => {
  const now = new Date("2026-11-02T13:00:00.000Z"); // 10:00 em São Paulo

  it("descreve prazos de ações comerciais", () => {
    expect(describeDue(new Date("2026-11-02T17:00:00.000Z"), TZ, now)).toEqual({ label: "Hoje, 14:00", overdue: false, today: true });
    expect(describeDue(new Date("2026-11-02T12:00:00.000Z"), TZ, now).overdue).toBe(true);
    expect(describeDue(new Date("2026-11-03T12:00:00.000Z"), TZ, now).label).toBe("Amanhã, 09:00");
    expect(describeDue(new Date("2026-10-30T12:00:00.000Z"), TZ, now)).toMatchObject({ label: "Atrasada desde 30/10", overdue: true });
  });

  it("descreve datas de retorno", () => {
    expect(describeDueDateKey("2026-11-02", "2026-11-02").label).toBe("Hoje");
    expect(describeDueDateKey("2026-11-07", "2026-11-02").label).toBe("Em 5 dias");
    expect(describeDueDateKey("2026-10-31", "2026-11-02")).toEqual({ label: "Atrasado há 2 dias", overdue: true, today: false });
  });
});

describe("cálculo das datas de protocolo (somente aritmética, sem regra clínica)", () => {
  const steps = [
    { id: "a", position: 1, offsetDays: 30, relativeTo: "START" as const },
    { id: "b", position: 2, offsetDays: 15, relativeTo: "PREVIOUS" as const },
    { id: "c", position: 3, offsetDays: 180, relativeTo: "START" as const },
    { id: "d", position: 4, offsetDays: 10, relativeTo: "PREVIOUS" as const },
  ];

  it("calcula a partir do início ou da etapa anterior", () => {
    const dues = computeStepDueDates("2026-11-02", steps);
    expect(Object.fromEntries(dues)).toEqual({
      a: "2026-12-02",
      b: "2026-12-17",
      c: "2027-05-01",
      d: "2027-05-11",
    });
  });

  it("recalcula apenas etapas encadeadas e ainda pendentes após uma realização", () => {
    const scheduled = steps.map((step) => ({
      ...step,
      dueKey: computeStepDueDates("2026-11-02", steps).get(step.id)!,
      adjustable: step.id !== "d",
    }));
    const changes = recomputeAfterCompletion(scheduled, "a", "2026-12-10");
    expect(Object.fromEntries(changes)).toEqual({ b: "2026-12-25" });
  });
});
