-- Assistente com IA generativa (agente com ferramentas do CRM).
-- Somente adições: nenhuma coluna removida, nenhum dado alterado.

-- Execuções de acompanhamento (sem mensagem de origem) e consumo da IA por execução.
CREATE TYPE "AssistantRunKind" AS ENUM ('REPLY', 'FOLLOW_UP');

ALTER TABLE "assistant_runs"
  ADD COLUMN "kind" "AssistantRunKind" NOT NULL DEFAULT 'REPLY',
  ADD COLUMN "follow_up_key" VARCHAR(120),
  ADD COLUMN "input_tokens" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "output_tokens" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "cache_read_tokens" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "cache_write_tokens" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "model_calls" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "model_latency_ms" INTEGER,
  ADD COLUMN "cost_micros" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "tool_calls" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ALTER COLUMN "inbound_message_id" DROP NOT NULL;

CREATE UNIQUE INDEX "assistant_runs_follow_up_key_key" ON "assistant_runs"("follow_up_key");

-- Resposta sempre tem a mensagem de origem; acompanhamento sempre tem a chave de idempotência.
ALTER TABLE "assistant_runs"
  ADD CONSTRAINT "assistant_runs_kind_subject_check" CHECK (
    ("kind" = 'REPLY' AND "inbound_message_id" IS NOT NULL)
    OR ("kind" = 'FOLLOW_UP' AND "follow_up_key" IS NOT NULL AND "inbound_message_id" IS NULL)
  );

ALTER TABLE "assistant_runs"
  ADD CONSTRAINT "assistant_runs_usage_check" CHECK (
    "input_tokens" >= 0 AND "output_tokens" >= 0 AND "cache_read_tokens" >= 0
    AND "cache_write_tokens" >= 0 AND "model_calls" >= 0 AND "cost_micros" >= 0
    AND ("model_latency_ms" IS NULL OR "model_latency_ms" >= 0)
  );

-- Notas do assistente sobre a conversa (cifradas pela aplicação).
ALTER TABLE "whatsapp_conversations"
  ADD COLUMN "assistant_memory" TEXT,
  ADD COLUMN "assistant_memory_updated_at" TIMESTAMPTZ(3);
