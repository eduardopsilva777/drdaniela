-- Sequências de acompanhamento: um retorno pode ter várias etapas ativas (uma por
-- regra do protocolo), mas nunca duas para a mesma regra. Etapas pausadas
-- continuam contando como ativas (não podem ser duplicadas enquanto pausadas).
--
-- Em migration separada porque usa o valor 'PAUSED', adicionado ao enum na
-- migration anterior (o PostgreSQL não permite usar um valor novo de enum na
-- mesma transação em que ele foi criado). Apenas o índice é recriado; nenhum
-- dado é alterado.

DROP INDEX "reminders_active_return_key";

CREATE UNIQUE INDEX "reminders_active_return_key" ON "reminders" (
  "return_id",
  COALESCE("follow_up_rule_id", '00000000-0000-0000-0000-000000000000'::uuid)
)
  WHERE "return_id" IS NOT NULL AND "status" IN ('PENDING', 'PROCESSING', 'PAUSED');

DROP INDEX "reminders_active_appointment_key";

CREATE UNIQUE INDEX "reminders_active_appointment_key" ON "reminders" ("appointment_id")
  WHERE "appointment_id" IS NOT NULL AND "status" IN ('PENDING', 'PROCESSING', 'PAUSED');
