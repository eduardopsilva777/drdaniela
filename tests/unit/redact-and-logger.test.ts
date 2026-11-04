import { describe, expect, it } from "vitest";

import { createLogger, type LogLevel } from "@/server/logger";
import { maskSensitiveText, redact, REDACTED, serializeError } from "@/server/logging/redact";

describe("mascaramento de dados pessoais em texto", () => {
  it.each([
    ["contato: maria.souza@exemplo.com.br", "contato: [email]"],
    ["fone +5511987654321 registrado", "fone [telefone] registrado"],
    ["ligar para (11) 98765-4321", "ligar para [telefone]"],
    ["ligar para 11 98765 4321", "ligar para [telefone]"],
    ["cpf 123.456.789-09", "cpf [cpf]"],
    ["cpf 12345678909", "cpf [cpf]"],
    ["celular 11987654321", "celular [telefone]"],
  ])("%s", (input, expected) => {
    expect(maskSensitiveText(input)).toBe(expected);
  });

  it("não altera datas, horários, UUIDs e números curtos", () => {
    const text = "2026-10-31T15:54:49.123Z id 0192f3a4-5b6c-7d8e-9f00-112233445566 total 42";
    expect(maskSensitiveText(text)).toBe(text);
  });

  it("mascara valores repetidos por mensagens de erro do banco", () => {
    const message =
      'new row violates check constraint "leads_phone_e164_check" Failing row contains (Ana, 11987654321, ana@x.com)';
    const masked = maskSensitiveText(message);
    expect(masked).not.toContain("11987654321");
    expect(masked).not.toContain("ana@x.com");
    expect(masked).toContain("leads_phone_e164_check");
  });

  it("omite nomes e demais valores da linha nas mensagens de restrição do PostgreSQL", () => {
    const check = [
      'new row for relation "patients" violates check constraint "patients_phone_e164_check"',
      "DETAIL: Failing row contains (0192f, Maria (Mãe) Souza, 1198765, f).",
    ].join("\n");
    const masked = maskSensitiveText(check);
    expect(masked).not.toMatch(/Maria|Souza|Mãe/);
    expect(masked).toContain("patients_phone_e164_check");
    expect(masked).toContain("Failing row contains ([valores omitidos])");

    const unique = 'duplicate key value violates unique constraint "leads_phone_key" DETAIL: Key (phone)=(+5511987654321) already exists.';
    expect(maskSensitiveText(unique)).toBe(
      'duplicate key value violates unique constraint "leads_phone_key" DETAIL: Key (phone)=([valor omitido]) already exists.',
    );

    const exclusion =
      `conflicting key value violates exclusion constraint "appointments_no_overlap" DETAIL: Key (professional_id, tstzrange(starts_at, ends_at, '[)'::text))=(0192f, ["2026-11-04 12:00:00+00","2026-11-04 13:00:00+00")) conflicts with existing key`;
    const maskedExclusion = maskSensitiveText(exclusion);
    expect(maskedExclusion).toContain("appointments_no_overlap");
    expect(maskedExclusion).not.toContain("2026-11-04 12:00");
  });
});

describe("redação de objetos", () => {
  it("substitui chaves sensíveis em qualquer nível", () => {
    const result = redact({
      userId: "u1",
      password: "segredo",
      headers: { authorization: "Bearer abc", cookie: "dz_session=abc" },
      lead: { phone: "+5511987654321", notes: "texto clínico", status: "NEW" },
      list: [{ token: "t" }],
    });
    expect(result).toEqual({
      userId: "u1",
      password: REDACTED,
      headers: { authorization: REDACTED, cookie: REDACTED },
      lead: { phone: REDACTED, notes: REDACTED, status: "NEW" },
      list: [{ token: REDACTED }],
    });
  });

  it("preserva identificadores técnicos que parecem números de telefone", () => {
    expect(redact({ digest: "4192061357", userId: "u-1", detail: "4192061357" })).toEqual({
      digest: "4192061357",
      userId: "u-1",
      detail: "[telefone]",
    });
  });

  it("serializa erros sem expor dados pessoais", () => {
    const error = Object.assign(new Error("duplicado: joana@exemplo.com"), { code: "P2002" });
    expect(serializeError(error)).toEqual({ name: "Error", message: "duplicado: [email]", code: "P2002" });
    expect(serializeError(error, true).stack).toBeDefined();
  });
});

describe("logger estruturado", () => {
  function capture(level: LogLevel = "info") {
    const lines: Array<{ level: LogLevel; line: string }> = [];
    const logger = createLogger({ level, format: "json", write: (lvl, line) => lines.push({ level: lvl, line }) });
    return { logger, lines };
  }

  it("respeita o nível mínimo", () => {
    const { logger, lines } = capture("warn");
    logger.info("ignorado");
    logger.warn("registrado");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!.line)).toMatchObject({ level: "warn", msg: "registrado" });
  });

  it("aplica redação ao contexto e às bindings", () => {
    const { logger, lines } = capture();
    logger.child({ requestId: "r1", sessionToken: "abc" }).error("falha", {
      email: "x@y.com",
      err: new Error("telefone 11987654321 inválido"),
    });
    const entry = JSON.parse(lines[0]!.line);
    expect(entry).toMatchObject({ requestId: "r1", sessionToken: REDACTED, email: REDACTED });
    expect(entry.err.message).toBe("telefone [telefone] inválido");
  });
});
