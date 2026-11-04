import type { DbExecutor } from "@/server/db/prisma";

import { redact } from "./logging/redact";

/**
 * Trilha de auditoria (LGPD): registra QUEM fez O QUÊ, QUANDO e sobre QUAL
 * registro. Não registra o conteúdo dos dados — `metadata` aceita apenas
 * valores simples e passa por redação defensiva.
 *
 * Sem `server-only`: scripts administrativos de linha de comando também auditam.
 */

export const AUDIT_ACTIONS = [
  // Acesso
  "auth.login.success",
  "auth.login.failure",
  "auth.login.blocked",
  "auth.logout",
  "auth.access_denied",
  // Equipe
  "user.create",
  "user.update",
  "user.activate",
  "user.deactivate",
  "user.password.reset",
  "user.password.change",
  "user.password.change.failure",
  // Procedimentos e protocolos
  "procedure.create",
  "procedure.update",
  "procedure.activate",
  "procedure.deactivate",
  "protocol.create",
  "protocol.update",
  "protocol.activate",
  "protocol.deactivate",
  // Leads
  "lead.create",
  "lead.update",
  "lead.status.change",
  "lead.interaction.create",
  "lead.convert",
  "lead.delete",
  // Pacientes
  "patient.create",
  "patient.update",
  "patient.activate",
  "patient.deactivate",
  "patient.consent.update",
  "patient.interaction.create",
  "patient.note.create",
  "patient.clinical_notes.view",
  "patient.export",
  // Agenda
  "appointment.create",
  "appointment.update",
  "appointment.reschedule",
  "appointment.status.change",
  // Protocolos aplicados, procedimentos realizados e retornos
  "patient_protocol.apply",
  "patient_protocol.cancel",
  "procedure_record.create",
  "return.create",
  "return.update",
  "return.status.change",
  // Lembretes e WhatsApp
  "reminder.cancel",
  "reminder.retry",
  "reminders.process",
  "whatsapp.message.send",
  "whatsapp.inbound.simulate",
  "whatsapp.conversation.mode",
  "whatsapp.conversation.erase",
  // Assistente virtual, base de conhecimento e automação
  "assistant.settings.update",
  "assistant.handoff",
  "assistant.test",
  "knowledge.entry.create",
  "knowledge.version.create",
  "knowledge.version.submit",
  "knowledge.version.approve",
  "knowledge.version.reject",
  "knowledge.entry.archive",
  "knowledge.entry.restore",
  "knowledge.gap.report",
  "knowledge.gap.resolve",
  "knowledge.gap.dismiss",
  "template.create",
  "template.update",
  "template.status.update",
  "template.sync",
  "consent.update",
  "task.complete",
  "task.cancel",
  "follow_up.pause",
  "follow_up.resume",
  "follow_up.cancel",
  "automation.run",
  // Manutenção (retenção de dados, rotação de chave)
  "data.retention.run",
  "data.encryption.rotate",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export type AuditMetadata = Record<string, string | number | boolean | null>;

export interface AuditEntry {
  action: AuditAction;
  actorId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  metadata?: AuditMetadata;
  ipAddress?: string | null;
  userAgent?: string | null;
}

function truncate(value: string | null | undefined, max: number): string | null {
  if (!value) return null;
  return value.length > max ? value.slice(0, max) : value;
}

export async function recordAudit(db: DbExecutor, entry: AuditEntry): Promise<void> {
  await db.auditLog.create({
    data: {
      action: entry.action,
      actorId: entry.actorId ?? null,
      entityType: truncate(entry.entityType, 40),
      entityId: truncate(entry.entityId, 64),
      ...(entry.metadata ? { metadata: redact(entry.metadata) as AuditMetadata } : {}),
      ipAddress: truncate(entry.ipAddress, 45),
      userAgent: truncate(entry.userAgent, 255),
    },
  });
}
