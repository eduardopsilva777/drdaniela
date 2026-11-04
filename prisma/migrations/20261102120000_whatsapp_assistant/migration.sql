-- Atendimento inteligente pelo WhatsApp: assistente virtual, base de conhecimento,
-- consentimentos, modelos da Meta, tarefas da equipe e acompanhamento de protocolos.
-- Migration ADITIVA: cria tipos, tabelas e colunas; nenhuma tabela ou coluna é removida.

-- CreateEnum
CREATE TYPE "ConversationMode" AS ENUM ('ASSISTANT', 'HUMAN');

-- CreateEnum
CREATE TYPE "MessageOrigin" AS ENUM ('CONTACT', 'STAFF', 'ASSISTANT', 'REMINDER', 'FOLLOW_UP', 'SYSTEM');

-- CreateEnum
CREATE TYPE "AssistantRunStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "AssistantOutcome" AS ENUM ('ANSWERED', 'ASKED', 'OFFERED_SLOTS', 'AWAITING_CONFIRMATION', 'BOOKED', 'RESCHEDULED', 'APPOINTMENT_CANCELLED', 'HANDOFF', 'NO_ANSWER', 'OPT_OUT', 'OPT_IN', 'SILENT', 'ERROR');

-- CreateEnum
CREATE TYPE "KnowledgeCategory" AS ENUM ('SERVICE', 'PRICING', 'CLINIC_INFO', 'POLICY', 'FAQ', 'SCHEDULING');

-- CreateEnum
CREATE TYPE "KnowledgeVersionStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "KnowledgeGapReason" AS ENUM ('NO_ANSWER', 'NEGATIVE_FEEDBACK', 'BLOCKED_ANSWER');

-- CreateEnum
CREATE TYPE "KnowledgeGapStatus" AS ENUM ('OPEN', 'RESOLVED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "TemplateCategory" AS ENUM ('UTILITY', 'MARKETING');

-- CreateEnum
CREATE TYPE "TemplateStatus" AS ENUM ('DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'PAUSED', 'DISABLED');

-- CreateEnum
CREATE TYPE "TemplateUsage" AS ENUM ('APPOINTMENT_REMINDER', 'RETURN_REMINDER', 'FOLLOW_UP');

-- CreateEnum
CREATE TYPE "ConsentPurpose" AS ENUM ('WHATSAPP', 'MARKETING');

-- CreateEnum
CREATE TYPE "ConsentSource" AS ENUM ('STAFF', 'CONTACT_KEYWORD', 'ASSISTANT');

-- CreateEnum
CREATE TYPE "TaskKind" AS ENUM ('HANDOFF', 'QUALIFIED_LEAD', 'FOLLOW_UP', 'AUTOMATION_FAILURE');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('OPEN', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "FollowUpAction" AS ENUM ('MESSAGE', 'TASK');

-- AlterEnum
ALTER TYPE "ReminderChannel" ADD VALUE 'TASK';

-- AlterEnum
ALTER TYPE "ReminderStatus" ADD VALUE 'PAUSED';

-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE 'ASSISTANT';

-- AlterTable
ALTER TABLE "protocols" ADD COLUMN     "duration_days" INTEGER;

-- AlterTable
ALTER TABLE "reminders" ADD COLUMN     "follow_up_rule_id" UUID,
ADD COLUMN     "lead_id" UUID,
ADD COLUMN     "paused_at" TIMESTAMPTZ(3),
ALTER COLUMN "patient_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "whatsapp_conversations" ADD COLUMN     "assistant_locked_until" TIMESTAMPTZ(3),
ADD COLUMN     "assistant_state" JSONB,
ADD COLUMN     "handoff_at" TIMESTAMPTZ(3),
ADD COLUMN     "handoff_reason" VARCHAR(200),
ADD COLUMN     "mode" "ConversationMode" NOT NULL DEFAULT 'ASSISTANT',
ADD COLUMN     "opted_out_at" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "whatsapp_messages" ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "idempotency_key" VARCHAR(120),
ADD COLUMN     "next_attempt_at" TIMESTAMPTZ(3),
ADD COLUMN     "origin" "MessageOrigin" NOT NULL DEFAULT 'STAFF';

-- CreateTable
CREATE TABLE "assistant_runs" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "inbound_message_id" UUID NOT NULL,
    "status" "AssistantRunStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(3),
    "locked_at" TIMESTAMPTZ(3),
    "engine" VARCHAR(80),
    "intent" VARCHAR(40),
    "confidence" REAL,
    "outcome" "AssistantOutcome",
    "source_entry_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "flags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "reply_message_id" UUID,
    "latency_ms" INTEGER,
    "error_code" VARCHAR(60),
    "error_message" VARCHAR(300),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(3),

    CONSTRAINT "assistant_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assistant_settings" (
    "id" VARCHAR(20) NOT NULL DEFAULT 'default',
    "config" JSONB NOT NULL,
    "updated_by_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "assistant_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_entries" (
    "id" UUID NOT NULL,
    "category" "KnowledgeCategory" NOT NULL,
    "procedure_id" UUID,
    "published_version_id" UUID,
    "is_archived" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "knowledge_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_entry_versions" (
    "id" UUID NOT NULL,
    "entry_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "content" TEXT NOT NULL,
    "keywords" VARCHAR(300) NOT NULL DEFAULT '',
    "status" "KnowledgeVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "change_note" VARCHAR(200),
    "author_id" UUID NOT NULL,
    "reviewed_by_id" UUID,
    "reviewed_at" TIMESTAMPTZ(3),
    "review_note" VARCHAR(300),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_entry_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_gaps" (
    "id" UUID NOT NULL,
    "question" TEXT NOT NULL,
    "reason" "KnowledgeGapReason" NOT NULL,
    "status" "KnowledgeGapStatus" NOT NULL DEFAULT 'OPEN',
    "conversation_id" UUID,
    "message_id" UUID,
    "feedback_note" VARCHAR(300),
    "reported_by_id" UUID,
    "resolved_entry_id" UUID,
    "resolved_by_id" UUID,
    "resolved_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "knowledge_gaps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_templates" (
    "id" UUID NOT NULL,
    "name" VARCHAR(512) NOT NULL,
    "language" VARCHAR(15) NOT NULL DEFAULT 'pt_BR',
    "category" "TemplateCategory" NOT NULL,
    "usage" "TemplateUsage" NOT NULL,
    "body" TEXT NOT NULL,
    "parameters" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "TemplateStatus" NOT NULL DEFAULT 'DRAFT',
    "status_source" VARCHAR(10),
    "status_updated_at" TIMESTAMPTZ(3),
    "rejection_reason" VARCHAR(300),
    "meta_template_id" VARCHAR(64),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "message_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consent_events" (
    "id" UUID NOT NULL,
    "phone" VARCHAR(20) NOT NULL,
    "patient_id" UUID,
    "lead_id" UUID,
    "conversation_id" UUID,
    "message_id" UUID,
    "purpose" "ConsentPurpose" NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "source" "ConsentSource" NOT NULL,
    "evidence" VARCHAR(200),
    "actor_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consent_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_tasks" (
    "id" UUID NOT NULL,
    "kind" "TaskKind" NOT NULL,
    "status" "TaskStatus" NOT NULL DEFAULT 'OPEN',
    "title" VARCHAR(160) NOT NULL,
    "details" VARCHAR(500),
    "urgent" BOOLEAN NOT NULL DEFAULT false,
    "due_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dedupe_key" VARCHAR(120),
    "conversation_id" UUID,
    "lead_id" UUID,
    "patient_id" UUID,
    "return_id" UUID,
    "reminder_id" UUID,
    "assignee_id" UUID,
    "completed_at" TIMESTAMPTZ(3),
    "completed_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "staff_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "follow_up_rules" (
    "id" UUID NOT NULL,
    "protocol_id" UUID NOT NULL,
    "days_before" INTEGER NOT NULL,
    "action" "FollowUpAction" NOT NULL,
    "template_id" UUID,
    "task_title" VARCHAR(120),
    "step_kinds" "ProtocolStepKind"[] DEFAULT ARRAY[]::"ProtocolStepKind"[],
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "follow_up_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "assistant_runs_inbound_message_id_key" ON "assistant_runs"("inbound_message_id");

-- CreateIndex
CREATE UNIQUE INDEX "assistant_runs_reply_message_id_key" ON "assistant_runs"("reply_message_id");

-- CreateIndex
CREATE INDEX "assistant_runs_status_next_attempt_at_idx" ON "assistant_runs"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "assistant_runs_conversation_id_created_at_idx" ON "assistant_runs"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "assistant_runs_created_at_idx" ON "assistant_runs"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_entries_published_version_id_key" ON "knowledge_entries"("published_version_id");

-- CreateIndex
CREATE INDEX "knowledge_entries_category_idx" ON "knowledge_entries"("category");

-- CreateIndex
CREATE INDEX "knowledge_entry_versions_status_idx" ON "knowledge_entry_versions"("status");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_entry_versions_entry_id_version_key" ON "knowledge_entry_versions"("entry_id", "version");

-- CreateIndex
CREATE INDEX "knowledge_gaps_status_created_at_idx" ON "knowledge_gaps"("status", "created_at");

-- CreateIndex
CREATE INDEX "message_templates_usage_status_idx" ON "message_templates"("usage", "status");

-- CreateIndex
CREATE UNIQUE INDEX "message_templates_name_language_key" ON "message_templates"("name", "language");

-- CreateIndex
CREATE INDEX "consent_events_phone_created_at_idx" ON "consent_events"("phone", "created_at");

-- CreateIndex
CREATE INDEX "consent_events_created_at_idx" ON "consent_events"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "staff_tasks_reminder_id_key" ON "staff_tasks"("reminder_id");

-- CreateIndex
CREATE INDEX "staff_tasks_status_due_at_idx" ON "staff_tasks"("status", "due_at");

-- CreateIndex
CREATE INDEX "staff_tasks_conversation_id_idx" ON "staff_tasks"("conversation_id");

-- CreateIndex
CREATE UNIQUE INDEX "follow_up_rules_protocol_id_days_before_action_key" ON "follow_up_rules"("protocol_id", "days_before", "action");

-- CreateIndex
CREATE INDEX "reminders_lead_id_idx" ON "reminders"("lead_id");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_messages_idempotency_key_key" ON "whatsapp_messages"("idempotency_key");

-- CreateIndex
CREATE INDEX "whatsapp_messages_status_next_attempt_at_idx" ON "whatsapp_messages"("status", "next_attempt_at");

-- AddForeignKey
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_follow_up_rule_id_fkey" FOREIGN KEY ("follow_up_rule_id") REFERENCES "follow_up_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_runs" ADD CONSTRAINT "assistant_runs_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "whatsapp_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_runs" ADD CONSTRAINT "assistant_runs_inbound_message_id_fkey" FOREIGN KEY ("inbound_message_id") REFERENCES "whatsapp_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_runs" ADD CONSTRAINT "assistant_runs_reply_message_id_fkey" FOREIGN KEY ("reply_message_id") REFERENCES "whatsapp_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_settings" ADD CONSTRAINT "assistant_settings_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_entries" ADD CONSTRAINT "knowledge_entries_procedure_id_fkey" FOREIGN KEY ("procedure_id") REFERENCES "procedures"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_entries" ADD CONSTRAINT "knowledge_entries_published_version_id_fkey" FOREIGN KEY ("published_version_id") REFERENCES "knowledge_entry_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_entry_versions" ADD CONSTRAINT "knowledge_entry_versions_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "knowledge_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_entry_versions" ADD CONSTRAINT "knowledge_entry_versions_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_entry_versions" ADD CONSTRAINT "knowledge_entry_versions_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_gaps" ADD CONSTRAINT "knowledge_gaps_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "whatsapp_conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_gaps" ADD CONSTRAINT "knowledge_gaps_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "whatsapp_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_gaps" ADD CONSTRAINT "knowledge_gaps_reported_by_id_fkey" FOREIGN KEY ("reported_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_gaps" ADD CONSTRAINT "knowledge_gaps_resolved_entry_id_fkey" FOREIGN KEY ("resolved_entry_id") REFERENCES "knowledge_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_gaps" ADD CONSTRAINT "knowledge_gaps_resolved_by_id_fkey" FOREIGN KEY ("resolved_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_events" ADD CONSTRAINT "consent_events_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_events" ADD CONSTRAINT "consent_events_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_events" ADD CONSTRAINT "consent_events_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "whatsapp_conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_events" ADD CONSTRAINT "consent_events_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "whatsapp_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_events" ADD CONSTRAINT "consent_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_tasks" ADD CONSTRAINT "staff_tasks_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "whatsapp_conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_tasks" ADD CONSTRAINT "staff_tasks_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_tasks" ADD CONSTRAINT "staff_tasks_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_tasks" ADD CONSTRAINT "staff_tasks_return_id_fkey" FOREIGN KEY ("return_id") REFERENCES "patient_returns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_tasks" ADD CONSTRAINT "staff_tasks_reminder_id_fkey" FOREIGN KEY ("reminder_id") REFERENCES "reminders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_tasks" ADD CONSTRAINT "staff_tasks_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_tasks" ADD CONSTRAINT "staff_tasks_completed_by_id_fkey" FOREIGN KEY ("completed_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_up_rules" ADD CONSTRAINT "follow_up_rules_protocol_id_fkey" FOREIGN KEY ("protocol_id") REFERENCES "protocols"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_up_rules" ADD CONSTRAINT "follow_up_rules_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "message_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- =============================================================================
-- Restrições que o Prisma não expressa
-- =============================================================================

-- Lembretes agora podem ser de pacientes ou de leads (avaliação agendada pelo assistente).
ALTER TABLE "reminders"
  ADD CONSTRAINT "reminders_subject_check" CHECK ("patient_id" IS NOT NULL OR "lead_id" IS NOT NULL);

ALTER TABLE "protocols"
  ADD CONSTRAINT "protocols_duration_check" CHECK ("duration_days" IS NULL OR "duration_days" BETWEEN 1 AND 3650);

ALTER TABLE "follow_up_rules"
  ADD CONSTRAINT "follow_up_rules_days_check" CHECK ("days_before" BETWEEN 0 AND 365);

ALTER TABLE "knowledge_entry_versions"
  ADD CONSTRAINT "knowledge_entry_versions_version_check" CHECK ("version" >= 1);

ALTER TABLE "assistant_runs"
  ADD CONSTRAINT "assistant_runs_confidence_check" CHECK ("confidence" IS NULL OR "confidence" BETWEEN 0 AND 1);

ALTER TABLE "consent_events"
  ADD CONSTRAINT "consent_events_phone_e164_check" CHECK ("phone" ~ '^\+[1-9][0-9]{7,14}$');

-- Configuração única do assistente.
ALTER TABLE "assistant_settings"
  ADD CONSTRAINT "assistant_settings_singleton_check" CHECK ("id" = 'default');

-- Uma tarefa ABERTA por motivo (ex.: um encaminhamento aberto por conversa).
CREATE UNIQUE INDEX "staff_tasks_open_dedupe_key" ON "staff_tasks" ("dedupe_key")
  WHERE "dedupe_key" IS NOT NULL AND "status" = 'OPEN';

-- Uma pendência de curadoria aberta por mensagem e motivo (avaliação repetida não duplica).
CREATE UNIQUE INDEX "knowledge_gaps_open_message_reason_key" ON "knowledge_gaps" ("message_id", "reason")
  WHERE "message_id" IS NOT NULL AND "status" = 'OPEN';

-- Retomada de lembretes interrompidos e reenvio de mensagens automáticas.
CREATE INDEX "reminders_paused_idx" ON "reminders" ("patient_id") WHERE "paused_at" IS NOT NULL;

-- =============================================================================
-- Preenchimento das colunas novas (dados existentes)
-- =============================================================================

-- Origem das mensagens já registradas: recebidas = contato; ligadas a lembretes = lembrete.
UPDATE "whatsapp_messages" SET "origin" = 'CONTACT' WHERE "direction" = 'INBOUND';
UPDATE "whatsapp_messages" SET "origin" = 'REMINDER'
  WHERE "id" IN (SELECT "message_id" FROM "reminders" WHERE "message_id" IS NOT NULL);
