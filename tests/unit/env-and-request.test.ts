import { describe, expect, it } from "vitest";

import { parseServerEnv } from "@/server/env";
import { extractClientIp } from "@/server/request-meta";

const BASE = { DATABASE_URL: "postgresql://u:p@localhost:5432/db" };

describe("variáveis de ambiente", () => {
  it("aplica valores padrão seguros", () => {
    const env = parseServerEnv(BASE);
    expect(env).toMatchObject({
      APP_TIMEZONE: "America/Sao_Paulo",
      SESSION_MAX_AGE_HOURS: 12,
      SESSION_IDLE_TIMEOUT_MINUTES: 120,
      TRUST_PROXY: false,
      LOG_LEVEL: "info",
    });
  });

  it("converte números e booleanos vindos como texto", () => {
    const env = parseServerEnv({ ...BASE, SESSION_MAX_AGE_HOURS: "8", TRUST_PROXY: "true" });
    expect(env.SESSION_MAX_AGE_HOURS).toBe(8);
    expect(env.TRUST_PROXY).toBe(true);
  });

  it("falha listando apenas o nome da variável, nunca o valor", () => {
    const secretish = "mysql://root:SENHA-SECRETA@host/db";
    expect(() => parseServerEnv({ DATABASE_URL: secretish })).toThrowError(/DATABASE_URL/);
    try {
      parseServerEnv({ DATABASE_URL: secretish });
    } catch (error) {
      expect((error as Error).message).not.toContain("SENHA-SECRETA");
    }
    expect(() => parseServerEnv({})).toThrowError(/DATABASE_URL/);
  });

  it("rejeita fuso horário inválido e limites de sessão fora da faixa", () => {
    expect(() => parseServerEnv({ ...BASE, APP_TIMEZONE: "Marte/Olympus" })).toThrowError(/APP_TIMEZONE/);
    expect(() => parseServerEnv({ ...BASE, SESSION_MAX_AGE_HOURS: "500" })).toThrowError(
      /SESSION_MAX_AGE_HOURS/,
    );
  });
});

describe("IP do cliente (X-Forwarded-For)", () => {
  it("usa a entrada mais à direita (adicionada pelo salto mais próximo)", () => {
    expect(extractClientIp("203.0.113.9, 198.51.100.7")).toBe("198.51.100.7");
    expect(extractClientIp("::1")).toBe("::1");
    expect(extractClientIp("2001:db8::1")).toBe("2001:db8::1");
  });

  it("descarta valores que não são endereços IP", () => {
    expect(extractClientIp(null)).toBeNull();
    expect(extractClientIp("")).toBeNull();
    expect(extractClientIp("unknown")).toBeNull();
    expect(extractClientIp("203.0.113.9, <script>")).toBeNull();
  });
});
