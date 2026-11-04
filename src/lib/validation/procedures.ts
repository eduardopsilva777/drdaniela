import { z } from "zod";

import {
  emptyToUndefined,
  intSchema,
  optionalIntSchema,
  optionalMoneySchema,
  optionalText,
  requiredText,
} from "./common";

export const procedureInputSchema = z.object({
  name: requiredText("o nome", 120, 2),
  category: optionalText("a categoria", 60),
  description: optionalText("a descrição", 500),
  durationMinutes: intSchema("a duração", 5, 720),
  price: optionalMoneySchema,
  suggestedReturnDays: optionalIntSchema("o intervalo de retorno", 1, 3650),
  color: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/, { error: "Cor inválida." })
      .optional(),
  ),
});

export type ProcedureInput = z.output<typeof procedureInputSchema>;
