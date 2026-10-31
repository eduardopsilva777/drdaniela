import type { UserRole } from "@/generated/prisma/enums";

/**
 * Controle de acesso baseado em papéis (RBAC).
 *
 * Este módulo é isomórfico: o servidor o usa para AUTORIZAR operações e a
 * interface o usa apenas para esconder elementos. Esconder um botão nunca é
 * uma proteção — toda Server Action e consulta valida a permissão no servidor.
 */

export const PERMISSIONS = [
  "dashboard:view",
  "leads:read",
  "leads:write",
  "leads:delete",
  "patients:read",
  "patients:write",
  "patients:archive",
  "clinical-notes:read",
  "clinical-notes:write",
  "appointments:read",
  "appointments:write",
  "procedures:read",
  "procedures:manage",
  "protocols:assign",
  "returns:read",
  "returns:write",
  "whatsapp:read",
  "whatsapp:send",
  "users:manage",
  "audit:read",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const RECEPTION_PERMISSIONS: readonly Permission[] = [
  "dashboard:view",
  "leads:read",
  "leads:write",
  "patients:read",
  "patients:write",
  "appointments:read",
  "appointments:write",
  "procedures:read",
  "returns:read",
  "returns:write",
  "whatsapp:read",
  "whatsapp:send",
];

const PROFESSIONAL_PERMISSIONS: readonly Permission[] = [
  ...RECEPTION_PERMISSIONS,
  "leads:delete",
  "patients:archive",
  "clinical-notes:read",
  "clinical-notes:write",
  "procedures:manage",
  "protocols:assign",
];

const ROLE_PERMISSIONS: Record<UserRole, ReadonlySet<Permission>> = {
  ADMIN: new Set(PERMISSIONS),
  PROFESSIONAL: new Set(PROFESSIONAL_PERMISSIONS),
  RECEPTION: new Set(RECEPTION_PERMISSIONS),
};

export const ROLE_LABELS: Record<UserRole, string> = {
  ADMIN: "Administração",
  PROFESSIONAL: "Profissional",
  RECEPTION: "Recepção",
};

export function hasPermission(role: UserRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.has(permission) ?? false;
}

export function permissionsFor(role: UserRole): Permission[] {
  return PERMISSIONS.filter((permission) => hasPermission(role, permission));
}
