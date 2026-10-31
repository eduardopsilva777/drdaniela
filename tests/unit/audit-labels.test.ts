import { describe, expect, it } from "vitest";

import { describeAuditAction, describeAuditDetail } from "@/lib/audit-labels";

describe("descrição dos eventos de auditoria", () => {
  it("traduz ações conhecidas e mantém a ação original quando desconhecida", () => {
    expect(describeAuditAction("auth.login.blocked")).toEqual({
      label: "Entrada bloqueada por excesso de tentativas",
      tone: "critical",
    });
    expect(describeAuditAction("acao.nova")).toEqual({ label: "acao.nova", tone: "neutral" });
  });

  it("explica o motivo de falhas e bloqueios sem expor dados pessoais", () => {
    expect(describeAuditDetail("auth.login.failure", { reason: "wrong_password" })).toBe("senha incorreta");
    expect(describeAuditDetail("auth.login.blocked", { scope: "ip" })).toBe("limite por endereço IP");
    expect(describeAuditDetail("auth.access_denied", { permission: "audit:read" })).toBe(
      "permissão audit:read",
    );
  });

  it("descreve eventos sobre outras contas com nome, perfil e origem", () => {
    expect(describeAuditDetail("user.create", { source: "cli", role: "RECEPTION" }, "Maria Souza")).toBe(
      "Maria Souza, perfil Recepção, pela linha de comando",
    );
    expect(describeAuditDetail("user.password.reset", { source: "cli", closedSessions: 2 }, "Ana")).toBe(
      "Ana, 2 sessões encerradas, pela linha de comando",
    );
    expect(describeAuditDetail("user.create", { role: "INVALIDO" })).toBeNull();
    expect(describeAuditDetail("auth.logout", null)).toBeNull();
  });
});
