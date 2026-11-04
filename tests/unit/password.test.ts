import { describe, expect, it } from "vitest";

import {
  burnPasswordVerification,
  hashPassword,
  passwordNeedsRehash,
  verifyPassword,
} from "@/server/auth/password";

describe("hash de senhas (Argon2id)", () => {
  it("gera hash Argon2id com os parâmetros mínimos da OWASP e sal aleatório", async () => {
    const first = await hashPassword("uma-senha-bem-longa");
    const second = await hashPassword("uma-senha-bem-longa");

    expect(first).toMatch(/^\$argon2id\$/);
    expect(first).not.toContain("uma-senha-bem-longa");
    expect(first).not.toBe(second);

    expect(first).toMatch(/\$m=19456,t=2,p=1\$/);
  });

  it("verifica a senha correta e rejeita a incorreta", async () => {
    const stored = await hashPassword("senha-correta-123");
    await expect(verifyPassword(stored, "senha-correta-123")).resolves.toBe(true);
    await expect(verifyPassword(stored, "senha-errada-123")).resolves.toBe(false);
    await expect(verifyPassword(stored, "")).resolves.toBe(false);
  });

  it("trata hash malformado como senha incorreta, sem lançar erro", async () => {
    await expect(verifyPassword("nao-e-um-hash", "qualquer")).resolves.toBe(false);
  });

  it("indica rehash quando o hash foi gerado com parâmetros mais fracos", async () => {
    const current = await hashPassword("senha-atual-123");
    expect(passwordNeedsRehash(current)).toBe(false);
    expect(passwordNeedsRehash("$argon2id$v=19$m=4096,t=1,p=1$YWJj$YWJj")).toBe(true);
    expect(passwordNeedsRehash("invalido")).toBe(true);
  });

  it("a verificação simulada (usuário inexistente) sempre falha", async () => {
    await expect(burnPasswordVerification("qualquer-senha")).resolves.toBe(false);
  });
});
