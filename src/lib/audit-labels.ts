import type { UserRole } from "@/generated/prisma/enums";
import { ROLE_LABELS } from "@/lib/auth/permissions";

/**
 * Textos de exibição dos eventos de auditoria. Isomórfico: usado pelas telas
 * de auditoria e pelo dashboard.
 */

export type AuditTone = "positive" | "neutral" | "warning" | "critical";

interface AuditLabel {
  label: string;
  tone: AuditTone;
}

const LABELS: Record<string, AuditLabel> = {
  "auth.login.success": { label: "Entrada no sistema", tone: "positive" },
  "auth.login.failure": { label: "Tentativa de entrada sem sucesso", tone: "warning" },
  "auth.login.blocked": { label: "Entrada bloqueada por excesso de tentativas", tone: "critical" },
  "auth.logout": { label: "Saída do sistema", tone: "neutral" },
  "auth.access_denied": { label: "Acesso negado", tone: "critical" },
  "user.create": { label: "Conta criada", tone: "neutral" },
  "user.password.reset": { label: "Senha redefinida", tone: "warning" },
};

const FAILURE_REASONS: Record<string, string> = {
  unknown_user: "e-mail não cadastrado",
  wrong_password: "senha incorreta",
  inactive_user: "usuário desativado",
};

const BLOCK_SCOPES: Record<string, string> = {
  email: "limite por e-mail",
  ip: "limite por endereço IP",
};

const SOURCES: Record<string, string> = {
  cli: "pela linha de comando",
  seed: "pelo seed de desenvolvimento",
};

export function describeAuditAction(action: string): AuditLabel {
  return LABELS[action] ?? { label: action, tone: "neutral" };
}

function isRole(value: unknown): value is UserRole {
  return typeof value === "string" && value in ROLE_LABELS;
}

/**
 * Detalhe legível a partir do `metadata` (que nunca contém dados pessoais) e,
 * quando o evento é sobre outra conta, do nome dessa conta.
 */
export function describeAuditDetail(
  action: string,
  metadata: unknown,
  subjectName?: string | null,
): string | null {
  const data = metadata && typeof metadata === "object" ? (metadata as Record<string, unknown>) : {};
  const source = typeof data.source === "string" ? SOURCES[data.source] : undefined;

  switch (action) {
    case "auth.login.failure":
      return typeof data.reason === "string" ? (FAILURE_REASONS[data.reason] ?? null) : null;
    case "auth.login.blocked":
      return typeof data.scope === "string" ? (BLOCK_SCOPES[data.scope] ?? null) : null;
    case "auth.access_denied":
      return typeof data.permission === "string" ? `permissão ${data.permission}` : null;
    case "user.create": {
      const parts = [subjectName, isRole(data.role) ? `perfil ${ROLE_LABELS[data.role]}` : null, source];
      return parts.filter(Boolean).join(", ") || null;
    }
    case "user.password.reset": {
      const closed = typeof data.closedSessions === "number" ? data.closedSessions : null;
      const sessions =
        closed === null ? null : closed === 1 ? "1 sessão encerrada" : `${closed} sessões encerradas`;
      return [subjectName, sessions, source].filter(Boolean).join(", ") || null;
    }
    default:
      return source ?? null;
  }
}
