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
  "patients:export",
  "clinical-notes:read",
  "clinical-notes:write",
  "appointments:read",
  "appointments:write",
  "procedures:read",
  "procedures:manage",
  "protocols:assign",
  "returns:read",
  "returns:write",
  "reminders:process",
  "whatsapp:read",
  "whatsapp:send",
  /** Apagar o conteúdo de uma conversa a pedido do titular (LGPD). */
  "whatsapp:erase",
  /** Base de conhecimento do assistente: consultar, propor e aprovar respostas. */
  "knowledge:read",
  "knowledge:write",
  "knowledge:approve",
  /** Configurações do assistente e modelos de mensagem da Meta. */
  "assistant:configure",
  /** Métricas e registros de automação do assistente. */
  "assistant:monitor",
  /** Tarefas da equipe (encaminhamentos, oportunidades, acompanhamentos). */
  "tasks:work",
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
  "knowledge:read",
  "knowledge:write",
  "tasks:work",
];

const PROFESSIONAL_PERMISSIONS: readonly Permission[] = [
  ...RECEPTION_PERMISSIONS,
  "leads:delete",
  "patients:archive",
  "clinical-notes:read",
  "clinical-notes:write",
  "procedures:manage",
  "protocols:assign",
  "reminders:process",
  "knowledge:approve",
  "assistant:monitor",
];

/**
 * Conta de sistema do assistente virtual: só o necessário para atender pelo
 * WhatsApp (cadastrar leads e agendar/remarcar/cancelar com confirmação).
 * Sem acesso a dados clínicos, exportação, configurações ou auditoria — e
 * sem login (bloqueado na autenticação).
 */
const ASSISTANT_PERMISSIONS: readonly Permission[] = [
  "leads:read",
  "leads:write",
  "appointments:read",
  "appointments:write",
  "procedures:read",
  "whatsapp:read",
  "whatsapp:send",
];

const ROLE_PERMISSIONS: Record<UserRole, ReadonlySet<Permission>> = {
  ADMIN: new Set(PERMISSIONS),
  PROFESSIONAL: new Set(PROFESSIONAL_PERMISSIONS),
  RECEPTION: new Set(RECEPTION_PERMISSIONS),
  ASSISTANT: new Set(ASSISTANT_PERMISSIONS),
};

export const ROLE_LABELS: Record<UserRole, string> = {
  ADMIN: "Administração",
  PROFESSIONAL: "Profissional",
  RECEPTION: "Recepção",
  ASSISTANT: "Assistente virtual (sistema)",
};

/** Perfis que podem ser atribuídos a pessoas da equipe (a conta do assistente é do sistema). */
export const STAFF_ROLES = ["ADMIN", "PROFESSIONAL", "RECEPTION"] as const satisfies readonly UserRole[];
export type StaffRole = (typeof STAFF_ROLES)[number];

export function hasPermission(role: UserRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.has(permission) ?? false;
}

export function permissionsFor(role: UserRole): Permission[] {
  return PERMISSIONS.filter((permission) => hasPermission(role, permission));
}
