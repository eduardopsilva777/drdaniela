import { describe, expect, it } from "vitest";

import { hasPermission, PERMISSIONS, permissionsFor } from "@/lib/auth/permissions";
import type { UserRole } from "@/generated/prisma/enums";

describe("controle de acesso por perfil", () => {
  it("administração tem todas as permissões", () => {
    expect(permissionsFor("ADMIN")).toEqual([...PERMISSIONS]);
  });

  it("recepção não acessa observações clínicas, auditoria nem gestão de usuários", () => {
    for (const permission of [
      "clinical-notes:read",
      "clinical-notes:write",
      "audit:read",
      "users:manage",
      "leads:delete",
      "patients:archive",
      "procedures:manage",
    ] as const) {
      expect(hasPermission("RECEPTION", permission), permission).toBe(false);
    }
    for (const permission of [
      "leads:read",
      "leads:write",
      "patients:read",
      "appointments:write",
      "returns:write",
      "whatsapp:send",
    ] as const) {
      expect(hasPermission("RECEPTION", permission), permission).toBe(true);
    }
  });

  it("profissional acessa dados clínicos, mas não auditoria nem gestão de usuários", () => {
    expect(hasPermission("PROFESSIONAL", "clinical-notes:read")).toBe(true);
    expect(hasPermission("PROFESSIONAL", "clinical-notes:write")).toBe(true);
    expect(hasPermission("PROFESSIONAL", "procedures:manage")).toBe(true);
    expect(hasPermission("PROFESSIONAL", "audit:read")).toBe(false);
    expect(hasPermission("PROFESSIONAL", "users:manage")).toBe(false);
  });

  it("perfil desconhecido não recebe nenhuma permissão", () => {
    const unknownRole = "INTRUSO" as UserRole;
    expect(permissionsFor(unknownRole)).toEqual([]);
  });
});
