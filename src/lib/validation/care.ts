import { z } from "zod";

import { ProtocolStepAnchor, ProtocolStepKind, ReturnKind } from "@/generated/prisma/enums";

import { followUpRulesSchema } from "./assistant";
import {
  checkboxSchema,
  dateKeySchema,
  emptyToUndefined,
  firstQueryValue,
  intSchema,
  optionalIntSchema,
  optionalText,
  optionalUuidSchema,
  pageSchema,
  requiredText,
  timeSchema,
} from "./common";

/** Protocolos, procedimentos realizados e retornos. */

export const protocolStepSchema = z.object({
  label: requiredText("o nome da etapa", 80),
  kind: z.enum(ProtocolStepKind),
  offsetDays: intSchema("o intervalo", 1, 3650),
  relativeTo: z.enum(ProtocolStepAnchor),
});

export const protocolInputSchema = z.object({
  name: requiredText("o nome", 120, 2),
  procedureId: z.uuid({ error: "Selecione o procedimento." }),
  description: optionalText("a descrição", 500),
  /** Duração do ciclo definida pela profissional (apenas informativa). */
  durationDays: optionalIntSchema("a duração do ciclo", 1, 3650),
  steps: z
    .array(protocolStepSchema)
    .min(1, { error: "Adicione ao menos uma etapa." })
    .max(20, { error: "Use no máximo 20 etapas." }),
  /** Quando lembrar o paciente (ou acionar a equipe) antes de cada retorno do protocolo. */
  followUpRules: followUpRulesSchema.default([]),
});

export type ProtocolInput = z.output<typeof protocolInputSchema>;

export const applyProtocolSchema = z.object({
  protocolId: z.uuid({ error: "Selecione o protocolo." }),
  startDate: dateKeySchema,
  registerInitialProcedure: checkboxSchema,
  professionalId: optionalUuidSchema,
  notes: optionalText("as observações", 500),
});

export type ApplyProtocolInput = z.output<typeof applyProtocolSchema>;

export const procedureRecordSchema = z.object({
  procedureId: z.uuid({ error: "Selecione o procedimento." }),
  date: dateKeySchema,
  time: z.preprocess(emptyToUndefined, timeSchema.optional()),
  professionalId: optionalUuidSchema,
  notes: optionalText("as observações", 500),
  /** Cria retorno com o intervalo sugerido do procedimento (definido pela profissional). */
  createReturn: checkboxSchema,
});

export type ProcedureRecordInput = z.output<typeof procedureRecordSchema>;

export const returnCreateSchema = z.object({
  title: requiredText("o título", 120, 2),
  kind: z.preprocess(emptyToUndefined, z.enum(ReturnKind).default("CUSTOM")),
  dueDate: dateKeySchema,
  procedureId: optionalUuidSchema,
  notes: optionalText("as observações", 500),
});

export type ReturnCreateInput = z.output<typeof returnCreateSchema>;

export const returnUpdateSchema = z.object({
  dueDate: dateKeySchema,
  notes: optionalText("as observações", 500),
});

export type ReturnUpdateInput = z.output<typeof returnUpdateSchema>;

export const returnResolveSchema = z.object({
  status: z.enum(["COMPLETED", "MISSED", "CANCELLED"]),
  /** Data em que o paciente compareceu (padrão: hoje). */
  date: z.preprocess(emptyToUndefined, dateKeySchema.optional()),
});

export type ReturnResolveInput = z.output<typeof returnResolveSchema>;

export const cancelProtocolSchema = z.object({
  reason: requiredText("o motivo", 200, 3),
});


export const returnFiltersSchema = z.object({
  aba: z.preprocess(firstQueryValue, z.enum(["retornos", "lembretes", "protocolos"])).catch("retornos"),
  situacao: z.preprocess(firstQueryValue, z.enum(["atrasados", "proximos", "pendentes", "resolvidos"])).catch("pendentes"),
  lembrete: z.preprocess(firstQueryValue, z.enum(["PENDING", "PROCESSING", "SENT", "FAILED", "CANCELLED", "PAUSED"]).optional()).catch(undefined),
  busca: z.preprocess(firstQueryValue, z.string().trim().max(80).optional()).catch(undefined),
  pagina: z.preprocess(firstQueryValue, pageSchema).catch(1),
});

export type ReturnFilters = z.output<typeof returnFiltersSchema>;
