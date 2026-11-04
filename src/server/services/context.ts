import type { UserRole } from "@/generated/prisma/enums";
import { hasPermission, type Permission } from "@/lib/auth/permissions";
import { AuthorizationError } from "@/server/auth/errors";

/**
 * Quem executa uma operação de negócio. Os serviços recebem o ator explicitamente
 * (em vez de ler a sessão) para serem testáveis e para registrar a auditoria.
 */
export interface Actor {
  id: string;
  name: string;
  role: UserRole;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * Defesa em profundidade: as Server Actions já exigem a permissão, mas cada
 * serviço confere de novo — uma chamada nova que esqueça a checagem falha fechada.
 */
export function assertPermission(actor: Actor, permission: Permission): void {
  if (!hasPermission(actor.role, permission)) {
    throw new AuthorizationError(permission);
  }
}

export function auditContext(actor: Actor) {
  return {
    actorId: actor.id,
    ipAddress: actor.ipAddress ?? null,
    userAgent: actor.userAgent ?? null,
  };
}
