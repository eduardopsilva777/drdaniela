import { describe, expect, it } from "vitest";

import { DEFAULT_AUTHENTICATED_PATH, sanitizeNextPath } from "@/lib/auth/redirect";

describe("destino após login (proteção contra open redirect)", () => {
  it("aceita caminhos internos e preserva a query string", () => {
    expect(sanitizeNextPath("/leads")).toBe("/leads");
    expect(sanitizeNextPath("/agenda?dia=2026-11-03")).toBe("/agenda?dia=2026-11-03");
    expect(sanitizeNextPath("/pacientes/0192f0f0-0000-7000-8000-000000000000")).toBe(
      "/pacientes/0192f0f0-0000-7000-8000-000000000000",
    );
  });

  it.each([
    "https://malicioso.com",
    "//malicioso.com",
    "///malicioso.com",
    "/\\malicioso.com",
    "\\\\malicioso.com",
    "javascript:alert(1)",
    "data:text/html,oi",
    "leads",
    "/leads\nSet-Cookie: x=1",
    "/leads\u0000",
    "/login",
    "/api/health",
    "",
    "/".padEnd(600, "a"),
  ])("rejeita %j", (value) => {
    expect(sanitizeNextPath(value)).toBe(DEFAULT_AUTHENTICATED_PATH);
  });

  it("rejeita tipos inesperados", () => {
    expect(sanitizeNextPath(undefined)).toBe(DEFAULT_AUTHENTICATED_PATH);
    expect(sanitizeNextPath(["/leads"])).toBe(DEFAULT_AUTHENTICATED_PATH);
    expect(sanitizeNextPath(42)).toBe(DEFAULT_AUTHENTICATED_PATH);
  });
});
