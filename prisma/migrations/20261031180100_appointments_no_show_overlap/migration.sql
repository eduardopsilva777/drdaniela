-- "Não compareceu" (NO_SHOW) libera o horário, assim como "Cancelado".
-- Em migration separada: o valor NO_SHOW do enum precisa estar confirmado
-- (commit) antes de ser usado em uma restrição.
ALTER TABLE "appointments" DROP CONSTRAINT "appointments_no_overlap";

ALTER TABLE "appointments"
  ADD CONSTRAINT "appointments_no_overlap"
  EXCLUDE USING gist (
    "professional_id" WITH =,
    tstzrange("starts_at", "ends_at", '[)') WITH &&
  ) WHERE ("status" NOT IN ('CANCELLED', 'NO_SHOW'));
