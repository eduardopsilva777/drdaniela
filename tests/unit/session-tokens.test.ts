import { describe, expect, it } from "vitest";

import {
  generateSessionToken,
  hashSessionToken,
  isWellFormedSessionToken,
} from "@/server/auth/tokens";

describe("tokens de sessão", () => {
  it("gera tokens base64url de 256 bits, únicos", () => {
    const tokens = new Set(Array.from({ length: 500 }, () => generateSessionToken()));
    expect(tokens.size).toBe(500);
    for (const token of tokens) {
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(Buffer.from(token, "base64url")).toHaveLength(32);
    }
  });

  it("armazena apenas o SHA-256 do token (determinístico, 64 hex)", () => {
    const token = generateSessionToken();
    const digest = hashSessionToken(token);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(hashSessionToken(token)).toBe(digest);
    expect(digest).not.toContain(token);
    expect(hashSessionToken(generateSessionToken())).not.toBe(digest);
  });

  it("rejeita valores que não têm o formato de um token", () => {
    expect(isWellFormedSessionToken(generateSessionToken())).toBe(true);
    for (const value of [undefined, null, 123, "", "curto", "a".repeat(44), "a".repeat(42) + "!", "' OR 1=1 --"]) {
      expect(isWellFormedSessionToken(value)).toBe(false);
    }
  });
});
