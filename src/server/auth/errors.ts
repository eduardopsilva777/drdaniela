import type { Permission } from "@/lib/auth/permissions";

/** Lançado quando um usuário autenticado tenta uma operação sem permissão. */
export class AuthorizationError extends Error {
  readonly permission: Permission;

  constructor(permission: Permission) {
    super(`Permissão necessária: ${permission}`);
    this.name = "AuthorizationError";
    this.permission = permission;
  }
}
