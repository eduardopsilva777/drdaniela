-- CreateEnum
CREATE TYPE "LeadPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "InteractionDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "ProtocolStepAnchor" AS ENUM ('START', 'PREVIOUS');

-- CreateEnum
CREATE TYPE "ReturnKind" AS ENUM ('SESSION', 'REVIEW', 'MAINTENANCE', 'CUSTOM');

-- CreateEnum
CREATE TYPE "ReturnStatus" AS ENUM ('PENDING', 'SCHEDULED', 'COMPLETED', 'MISSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ReminderChannel" AS ENUM ('WHATSAPP');

-- CreateEnum
CREATE TYPE "AppointmentEventType" AS ENUM ('CREATED', 'RESCHEDULED', 'STATUS_CHANGED', 'UPDATED');

-- AlterEnum (IF NOT EXISTS: valores de enum não podem ser removidos no PostgreSQL,
-- o que torna esta migration segura para reaplicação após uma falha parcial)
ALTER TYPE "AppointmentStatus" ADD VALUE IF NOT EXISTS 'NO_SHOW';

-- AlterEnum
ALTER TYPE "InteractionType" ADD VALUE IF NOT EXISTS 'SYSTEM';

-- AlterEnum
ALTER TYPE "MessageStatus" ADD VALUE IF NOT EXISTS 'SIMULATED';

-- A tabela return_reminders é substituída por patient_returns (retornos) e
-- reminders (fila de lembretes). Os tipos ReminderKind/ReminderStatus mudam de
-- significado e são recriados depois que a tabela antiga deixa de existir.
-- (O SQL gerado pelo Prisma tentava alterar a tabela nova antes de criá-la.)
DROP TABLE "return_reminders";
DROP TYPE "ReminderKind";
DROP TYPE "ReminderStatus";
CREATE TYPE "ReminderKind" AS ENUM ('RETURN', 'APPOINTMENT');
CREATE TYPE "ReminderStatus" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'FAILED', 'CANCELLED');

-- DropForeignKey
ALTER TABLE "lead_interactions" DROP CONSTRAINT "lead_interactions_author_id_fkey";

-- DropForeignKey
ALTER TABLE "lead_interactions" DROP CONSTRAINT "lead_interactions_lead_id_fkey";

-- DropIndex
DROP INDEX "leads_phone_idx";

-- AlterTable
ALTER TABLE "appointments" ADD COLUMN     "no_show_at" TIMESTAMPTZ(3),
ADD COLUMN     "rescheduled_from_id" UUID;

-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "email" VARCHAR(254),
ADD COLUMN     "lost_at" TIMESTAMPTZ(3),
ADD COLUMN     "next_action_at" TIMESTAMPTZ(3),
ADD COLUMN     "next_action_note" VARCHAR(200),
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "peak_status" "LeadStatus" NOT NULL DEFAULT 'NEW',
ADD COLUMN     "priority" "LeadPriority" NOT NULL DEFAULT 'MEDIUM',
ADD COLUMN     "status_changed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "patient_protocols" ADD COLUMN     "cancellation_reason" VARCHAR(200),
ADD COLUMN     "cancelled_at" TIMESTAMPTZ(3);

-- AlterTable (archived_at -> is_active/inactivated_at, preservando dados existentes)
ALTER TABLE "patients" ADD COLUMN     "image_use_consent" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "image_use_consent_at" TIMESTAMPTZ(3),
ADD COLUMN     "inactivated_at" TIMESTAMPTZ(3),
ADD COLUMN     "inactivation_reason" VARCHAR(200),
ADD COLUMN     "is_active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "marketing_opt_in" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "marketing_opt_in_at" TIMESTAMPTZ(3),
ADD COLUMN     "source" "LeadSource",
ADD COLUMN     "source_detail" VARCHAR(120);

UPDATE "patients" SET "is_active" = ("archived_at" IS NULL), "inactivated_at" = "archived_at";

ALTER TABLE "patients" DROP COLUMN "archived_at";

-- AlterTable
ALTER TABLE "procedures" ADD COLUMN     "price_cents" INTEGER,
ADD COLUMN     "suggested_return_days" INTEGER;

-- AlterTable
ALTER TABLE "protocol_steps" ADD COLUMN     "relative_to" "ProtocolStepAnchor" NOT NULL DEFAULT 'START';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "must_change_password" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "whatsapp_conversations" ADD COLUMN     "unread_count" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "whatsapp_messages" ADD COLUMN     "provider" VARCHAR(20) NOT NULL DEFAULT 'development';
ALTER TABLE "whatsapp_messages" ALTER COLUMN "provider" DROP DEFAULT;

-- DropTable
DROP TABLE "lead_interactions";

-- CreateTable
CREATE TABLE "interactions" (
    "id" UUID NOT NULL,
    "lead_id" UUID,
    "patient_id" UUID,
    "type" "InteractionType" NOT NULL,
    "direction" "InteractionDirection",
    "content" TEXT,
    "from_status" "LeadStatus",
    "to_status" "LeadStatus",
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "author_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "interactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_returns" (
    "id" UUID NOT NULL,
    "patient_id" UUID NOT NULL,
    "procedure_id" UUID,
    "patient_protocol_id" UUID,
    "protocol_step_id" UUID,
    "source_record_id" UUID,
    "appointment_id" UUID,
    "kind" "ReturnKind" NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "due_date" DATE NOT NULL,
    "status" "ReturnStatus" NOT NULL DEFAULT 'PENDING',
    "notes" VARCHAR(500),
    "resolved_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "patient_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reminders" (
    "id" UUID NOT NULL,
    "kind" "ReminderKind" NOT NULL,
    "channel" "ReminderChannel" NOT NULL DEFAULT 'WHATSAPP',
    "status" "ReminderStatus" NOT NULL DEFAULT 'PENDING',
    "patient_id" UUID NOT NULL,
    "procedure_id" UUID,
    "return_id" UUID,
    "appointment_id" UUID,
    "scheduled_for" TIMESTAMPTZ(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 3,
    "next_attempt_at" TIMESTAMPTZ(3),
    "locked_at" TIMESTAMPTZ(3),
    "sent_at" TIMESTAMPTZ(3),
    "simulated" BOOLEAN NOT NULL DEFAULT false,
    "last_error" VARCHAR(300),
    "message_id" UUID,
    "cancelled_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "reminders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointment_events" (
    "id" UUID NOT NULL,
    "appointment_id" UUID NOT NULL,
    "type" "AppointmentEventType" NOT NULL,
    "from_status" "AppointmentStatus",
    "to_status" "AppointmentStatus",
    "previous_starts_at" TIMESTAMPTZ(3),
    "previous_ends_at" TIMESTAMPTZ(3),
    "new_starts_at" TIMESTAMPTZ(3),
    "new_ends_at" TIMESTAMPTZ(3),
    "reason" VARCHAR(300),
    "actor_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "appointment_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "interactions_lead_id_occurred_at_idx" ON "interactions"("lead_id", "occurred_at");

-- CreateIndex
CREATE INDEX "interactions_patient_id_occurred_at_idx" ON "interactions"("patient_id", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "patient_returns_appointment_id_key" ON "patient_returns"("appointment_id");

-- CreateIndex
CREATE INDEX "patient_returns_status_due_date_idx" ON "patient_returns"("status", "due_date");

-- CreateIndex
CREATE INDEX "patient_returns_patient_id_idx" ON "patient_returns"("patient_id");

-- CreateIndex
CREATE INDEX "patient_returns_patient_protocol_id_idx" ON "patient_returns"("patient_protocol_id");

-- CreateIndex
CREATE UNIQUE INDEX "reminders_message_id_key" ON "reminders"("message_id");

-- CreateIndex
CREATE INDEX "reminders_status_scheduled_for_idx" ON "reminders"("status", "scheduled_for");

-- CreateIndex
CREATE INDEX "reminders_patient_id_idx" ON "reminders"("patient_id");

-- CreateIndex
CREATE INDEX "reminders_return_id_idx" ON "reminders"("return_id");

-- CreateIndex
CREATE INDEX "reminders_appointment_id_idx" ON "reminders"("appointment_id");

-- CreateIndex
CREATE INDEX "appointment_events_appointment_id_created_at_idx" ON "appointment_events"("appointment_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "appointments_rescheduled_from_id_key" ON "appointments"("rescheduled_from_id");

-- CreateIndex
CREATE INDEX "appointments_status_starts_at_idx" ON "appointments"("status", "starts_at");

-- CreateIndex
CREATE UNIQUE INDEX "leads_phone_key" ON "leads"("phone");

-- CreateIndex
CREATE INDEX "leads_owner_id_idx" ON "leads"("owner_id");

-- CreateIndex
CREATE INDEX "leads_next_action_at_idx" ON "leads"("next_action_at");

-- CreateIndex
CREATE INDEX "login_attempts_created_at_idx" ON "login_attempts"("created_at");

-- CreateIndex
CREATE INDEX "patients_is_active_idx" ON "patients"("is_active");

-- CreateIndex
CREATE INDEX "procedure_records_performed_at_idx" ON "procedure_records"("performed_at");

-- CreateIndex
CREATE INDEX "whatsapp_conversations_patient_id_idx" ON "whatsapp_conversations"("patient_id");

-- CreateIndex
CREATE INDEX "whatsapp_conversations_lead_id_idx" ON "whatsapp_conversations"("lead_id");

-- AddForeignKey
ALTER TABLE "interactions" ADD CONSTRAINT "interactions_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interactions" ADD CONSTRAINT "interactions_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "interactions" ADD CONSTRAINT "interactions_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_returns" ADD CONSTRAINT "patient_returns_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_returns" ADD CONSTRAINT "patient_returns_procedure_id_fkey" FOREIGN KEY ("procedure_id") REFERENCES "procedures"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_returns" ADD CONSTRAINT "patient_returns_patient_protocol_id_fkey" FOREIGN KEY ("patient_protocol_id") REFERENCES "patient_protocols"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_returns" ADD CONSTRAINT "patient_returns_protocol_step_id_fkey" FOREIGN KEY ("protocol_step_id") REFERENCES "protocol_steps"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_returns" ADD CONSTRAINT "patient_returns_source_record_id_fkey" FOREIGN KEY ("source_record_id") REFERENCES "procedure_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_returns" ADD CONSTRAINT "patient_returns_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_procedure_id_fkey" FOREIGN KEY ("procedure_id") REFERENCES "procedures"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_return_id_fkey" FOREIGN KEY ("return_id") REFERENCES "patient_returns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "whatsapp_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_rescheduled_from_id_fkey" FOREIGN KEY ("rescheduled_from_id") REFERENCES "appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_events" ADD CONSTRAINT "appointment_events_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_events" ADD CONSTRAINT "appointment_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- =============================================================================
-- Restrições adicionais (não expressáveis no schema do Prisma)
-- =============================================================================

-- Toda interação pertence a um lead, a um paciente ou a ambos.
ALTER TABLE "interactions"
  ADD CONSTRAINT "interactions_subject_check" CHECK ("lead_id" IS NOT NULL OR "patient_id" IS NOT NULL);

-- E-mails sempre normalizados em minúsculas.
ALTER TABLE "leads"
  ADD CONSTRAINT "leads_email_lowercase_check" CHECK ("email" IS NULL OR "email" = lower("email"));
ALTER TABLE "patients"
  ADD CONSTRAINT "patients_email_lowercase_check" CHECK ("email" IS NULL OR "email" = lower("email"));

-- Procedimentos: preço não negativo e intervalo de retorno plausível.
ALTER TABLE "procedures"
  ADD CONSTRAINT "procedures_price_check" CHECK ("price_cents" IS NULL OR "price_cents" >= 0),
  ADD CONSTRAINT "procedures_return_days_check" CHECK ("suggested_return_days" IS NULL OR "suggested_return_days" BETWEEN 1 AND 3650);

-- Fila de lembretes: contadores válidos.
ALTER TABLE "reminders"
  ADD CONSTRAINT "reminders_attempts_check" CHECK ("attempts" >= 0 AND "max_attempts" BETWEEN 1 AND 10);

-- Idempotência da fila: no máximo um lembrete ativo por retorno e por agendamento.
CREATE UNIQUE INDEX "reminders_active_return_key" ON "reminders" ("return_id")
  WHERE "return_id" IS NOT NULL AND "status" IN ('PENDING', 'PROCESSING');
CREATE UNIQUE INDEX "reminders_active_appointment_key" ON "reminders" ("appointment_id")
  WHERE "appointment_id" IS NOT NULL AND "status" IN ('PENDING', 'PROCESSING');
