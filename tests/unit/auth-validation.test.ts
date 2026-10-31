import { describe, expect, it } from "vitest";

import { loginSchema, newPasswordSchema } from "@/lib/validation/auth";

describe("validação do login", () => {
  it("normaliza o e-mail (espaços e maiúsculas)", () => {
    const parsed = loginSchema.parse({ email: "  Daniela@Clinica.COM.br ", password: "x" });
    expect(parsed.email).toBe("daniela@clinica.com.br");
  });

  it("rejeita e-mail inválido, senha vazia e entradas não textuais", () => {
    expect(loginSchema.safeParse({ email: "nao-e-email", password: "x" }).success).toBe(false);
    expect(loginSchema.safeParse({ email: "a@b.com", password: "" }).success).toBe(false);
    expect(loginSchema.safeParse({ email: null, password: null }).success).toBe(false);
    expect(loginSchema.safeParse({ email: "a@b.com", password: "x".repeat(257) }).success).toBe(false);
  });
});

describe("política de novas senhas", () => {
  it("exige ao menos 12 caracteres", () => {
    expect(newPasswordSchema.safeParse("curta-123").success).toBe(false);
    expect(newPasswordSchema.safeParse("uma frase longa e única").success).toBe(true);
  });

  it("rejeita senhas óbvias ou repetitivas", () => {
    expect(newPasswordSchema.safeParse("123456789012").success).toBe(false);
    expect(newPasswordSchema.safeParse("aaaaaaaaaaaaaaaa").success).toBe(false);
  });

  it("limita o tamanho máximo", () => {
    expect(newPasswordSchema.safeParse("ab1-".repeat(40)).success).toBe(false);
  });
});
