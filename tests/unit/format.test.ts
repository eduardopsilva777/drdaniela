import { describe, expect, it } from "vitest";

import {
  firstName,
  formatDateTime,
  formatDurationMinutes,
  greetingFor,
  initials,
} from "@/lib/format";

describe("formatação no fuso da clínica", () => {
  it("converte UTC para o horário de São Paulo", () => {
    // 31/10/2026 02:30 UTC = 30/10/2026 23:30 em São Paulo (UTC-3).
    expect(formatDateTime(new Date("2026-10-31T02:30:00Z"))).toBe("30/10/2026, 23:30");
  });

  it("escolhe a saudação pelo horário local", () => {
    expect(greetingFor(new Date("2026-10-31T11:00:00Z"))).toBe("Bom dia"); // 08:00
    expect(greetingFor(new Date("2026-10-31T17:00:00Z"))).toBe("Boa tarde"); // 14:00
    expect(greetingFor(new Date("2026-10-31T23:30:00Z"))).toBe("Boa noite"); // 20:30
    expect(greetingFor(new Date("2026-10-31T06:00:00Z"))).toBe("Boa noite"); // 03:00
  });

  it("extrai primeiro nome e iniciais ignorando títulos e preposições", () => {
    expect(firstName("Dra. Daniela Zilioli")).toBe("Daniela");
    expect(firstName("Rafaela")).toBe("Rafaela");
    expect(initials("Dra. Daniela Zilioli")).toBe("DZ");
    expect(initials("Maria da Silva")).toBe("MS");
    expect(initials("Helena")).toBe("H");
  });

  it("descreve durações em horas ou minutos", () => {
    expect(formatDurationMinutes(120)).toBe("2 horas");
    expect(formatDurationMinutes(60)).toBe("1 hora");
    expect(formatDurationMinutes(45)).toBe("45 minutos");
  });
});
