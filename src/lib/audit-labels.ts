import type { UserRole } from "@/generated/prisma/enums";
import { ROLE_LABELS } from "@/lib/auth/permissions";
import {
  APPOINTMENT_STATUS_LABELS,
  LEAD_STATUS_LABELS,
  RETURN_STATUS_LABELS,
} from "@/lib/labels";

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
  "user.update": { label: "Conta alterada", tone: "neutral" },
  "user.activate": { label: "Conta reativada", tone: "neutral" },
  "user.deactivate": { label: "Conta desativada", tone: "warning" },
  "user.password.reset": { label: "Senha redefinida", tone: "warning" },
  "user.password.change": { label: "Senha alterada pela própria pessoa", tone: "neutral" },
  "user.password.change.failure": { label: "Troca de senha recusada (senha atual incorreta)", tone: "warning" },
  "procedure.create": { label: "Procedimento cadastrado", tone: "neutral" },
  "procedure.update": { label: "Procedimento alterado", tone: "neutral" },
  "procedure.activate": { label: "Procedimento reativado", tone: "neutral" },
  "procedure.deactivate": { label: "Procedimento desativado", tone: "neutral" },
  "protocol.create": { label: "Protocolo cadastrado", tone: "neutral" },
  "protocol.update": { label: "Protocolo alterado", tone: "neutral" },
  "protocol.activate": { label: "Protocolo reativado", tone: "neutral" },
  "protocol.deactivate": { label: "Protocolo desativado", tone: "neutral" },
  "lead.create": { label: "Lead cadastrado", tone: "neutral" },
  "lead.update": { label: "Lead alterado", tone: "neutral" },
  "lead.status.change": { label: "Etapa do lead alterada", tone: "neutral" },
  "lead.interaction.create": { label: "Interação registrada no lead", tone: "neutral" },
  "lead.convert": { label: "Lead convertido em paciente", tone: "positive" },
  "lead.delete": { label: "Lead excluído", tone: "warning" },
  "patient.create": { label: "Paciente cadastrado", tone: "neutral" },
  "patient.update": { label: "Cadastro do paciente alterado", tone: "neutral" },
  "patient.activate": { label: "Paciente reativado", tone: "neutral" },
  "patient.deactivate": { label: "Paciente inativado", tone: "warning" },
  "patient.consent.update": { label: "Consentimento alterado", tone: "warning" },
  "patient.interaction.create": { label: "Interação registrada no paciente", tone: "neutral" },
  "patient.note.create": { label: "Observação registrada", tone: "neutral" },
  "patient.clinical_notes.view": { label: "Observações clínicas consultadas", tone: "warning" },
  "patient.export": { label: "Dados do paciente exportados", tone: "critical" },
  "appointment.create": { label: "Agendamento criado", tone: "neutral" },
  "appointment.update": { label: "Agendamento alterado", tone: "neutral" },
  "appointment.reschedule": { label: "Agendamento remarcado", tone: "neutral" },
  "appointment.status.change": { label: "Status do agendamento alterado", tone: "neutral" },
  "patient_protocol.apply": { label: "Protocolo aplicado ao paciente", tone: "neutral" },
  "patient_protocol.cancel": { label: "Protocolo do paciente cancelado", tone: "warning" },
  "procedure_record.create": { label: "Procedimento realizado registrado", tone: "neutral" },
  "return.create": { label: "Retorno programado", tone: "neutral" },
  "return.update": { label: "Retorno alterado", tone: "neutral" },
  "return.status.change": { label: "Situação do retorno alterada", tone: "neutral" },
  "reminder.cancel": { label: "Lembrete cancelado", tone: "neutral" },
  "reminder.retry": { label: "Lembrete reenfileirado", tone: "neutral" },
  "reminders.process": { label: "Fila de lembretes processada", tone: "neutral" },
  "whatsapp.message.send": { label: "Mensagem enviada pelo WhatsApp", tone: "neutral" },
  "whatsapp.inbound.simulate": { label: "Mensagem recebida simulada", tone: "neutral" },
  "whatsapp.conversation.mode": { label: "Atendimento da conversa alternado (assistente/equipe)", tone: "neutral" },
  "whatsapp.conversation.erase": { label: "Conteúdo de conversa apagado a pedido do titular", tone: "critical" },
  "assistant.settings.update": { label: "Configurações do assistente alteradas", tone: "warning" },
  "assistant.handoff": { label: "Assistente encaminhou a conversa para a equipe", tone: "neutral" },
  "assistant.test": { label: "Pergunta testada no assistente", tone: "neutral" },
  "knowledge.entry.create": { label: "Entrada criada na base de conhecimento", tone: "neutral" },
  "knowledge.version.create": { label: "Nova versão de resposta registrada", tone: "neutral" },
  "knowledge.version.submit": { label: "Resposta enviada para aprovação", tone: "neutral" },
  "knowledge.version.approve": { label: "Resposta aprovada e publicada", tone: "positive" },
  "knowledge.version.reject": { label: "Resposta recusada na revisão", tone: "neutral" },
  "knowledge.entry.archive": { label: "Entrada da base de conhecimento arquivada", tone: "warning" },
  "knowledge.entry.restore": { label: "Entrada da base de conhecimento restaurada", tone: "neutral" },
  "knowledge.gap.report": { label: "Resposta do assistente avaliada negativamente", tone: "warning" },
  "knowledge.gap.resolve": { label: "Pergunta sem resposta resolvida", tone: "positive" },
  "knowledge.gap.dismiss": { label: "Pergunta sem resposta descartada", tone: "neutral" },
  "template.create": { label: "Modelo de mensagem cadastrado", tone: "neutral" },
  "template.update": { label: "Modelo de mensagem alterado", tone: "neutral" },
  "template.status.update": { label: "Situação de modelo de mensagem alterada", tone: "warning" },
  "template.sync": { label: "Modelos sincronizados com a Meta", tone: "neutral" },
  "consent.update": { label: "Consentimento de mensagens alterado pelo contato", tone: "warning" },
  "task.complete": { label: "Tarefa concluída", tone: "positive" },
  "task.cancel": { label: "Tarefa cancelada", tone: "neutral" },
  "follow_up.pause": { label: "Sequência de acompanhamento pausada", tone: "neutral" },
  "follow_up.resume": { label: "Sequência de acompanhamento retomada", tone: "neutral" },
  "follow_up.cancel": { label: "Sequência de acompanhamento cancelada", tone: "warning" },
  "automation.run": { label: "Ciclo de automação executado", tone: "neutral" },
  "data.retention.run": { label: "Rotina de retenção de dados executada", tone: "warning" },
  "data.encryption.rotate": { label: "Chave de cifragem das observações rotacionada", tone: "warning" },
};

const FAILURE_REASONS: Record<string, string> = {
  unknown_user: "e-mail não cadastrado",
  wrong_password: "senha incorreta",
  inactive_user: "usuário desativado",
  system_account: "conta de sistema (sem acesso)",
};

const BLOCK_SCOPES: Record<string, string> = {
  email: "limite por e-mail",
  ip: "limite por endereço IP",
};

const SOURCES: Record<string, string> = {
  cli: "pela linha de comando",
  seed: "pelo seed de desenvolvimento",
  admin: "pela administração",
  cron: "pelo agendador automático",
  assistant: "pelo assistente virtual",
  contact: "a pedido do contato",
};

const STATUS_LABELS: Record<string, Record<string, string>> = {
  "lead.status.change": LEAD_STATUS_LABELS,
  "appointment.status.change": APPOINTMENT_STATUS_LABELS,
  "return.status.change": RETURN_STATUS_LABELS,
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

  const statusLabels = STATUS_LABELS[action];
  if (statusLabels && typeof data.from === "string" && typeof data.to === "string") {
    return `${statusLabels[data.from] ?? data.from} → ${statusLabels[data.to] ?? data.to}`;
  }

  switch (action) {
    case "auth.login.failure":
      return typeof data.reason === "string" ? (FAILURE_REASONS[data.reason] ?? null) : null;
    case "auth.login.blocked":
      return typeof data.scope === "string" ? (BLOCK_SCOPES[data.scope] ?? null) : null;
    case "auth.access_denied":
      return typeof data.permission === "string" ? `permissão ${data.permission}` : null;
    case "user.create":
    case "user.update": {
      const parts = [subjectName, isRole(data.role) ? `perfil ${ROLE_LABELS[data.role]}` : null, source];
      return parts.filter(Boolean).join(", ") || null;
    }
    case "user.password.reset": {
      const closed = typeof data.closedSessions === "number" ? data.closedSessions : null;
      const sessions =
        closed === null ? null : closed === 1 ? "1 sessão encerrada" : `${closed} sessões encerradas`;
      return [subjectName, sessions, source].filter(Boolean).join(", ") || null;
    }
    case "user.activate":
    case "user.deactivate":
      return subjectName ?? null;
    case "patient.consent.update":
      return typeof data.consent === "string"
        ? `${data.consent}: ${data.granted === true ? "concedido" : "revogado"}`
        : null;
    case "whatsapp.message.send":
      return data.simulated === true ? "simulada (desenvolvimento)" : null;
    case "reminders.process":
      return typeof data.processed === "number" ? `${data.processed} lembrete(s) processado(s)` : null;
    default:
      return source ?? null;
  }
}
