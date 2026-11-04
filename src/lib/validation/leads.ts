import { z } from "zod";

import {
  InteractionDirection,
  LeadPriority,
  LeadSource,
  LeadStatus,
} from "@/generated/prisma/enums";

import {
  checkboxSchema,
  emptyToUndefined,
  firstQueryValue,
  optionalDateKeySchema,
  optionalEmailSchema,
  optionalText,
  optionalUuidSchema,
  pageSchema,
  phoneSchema,
  requiredText,
  timeSchema,
  uuidSchema,
} from "./common";

const optionalTimeSchema = z.preprocess(emptyToUndefined, timeSchema.optional());

/** Próxima ação: data obrigatória quando há horário ou descrição. */
const nextActionFields = {
  nextActionDate: optionalDateKeySchema,
  nextActionTime: optionalTimeSchema,
  nextActionNote: optionalText("a próxima ação", 200),
};

function refineNextAction(
  value: { nextActionDate?: string; nextActionTime?: string; nextActionNote?: string },
  context: z.RefinementCtx,
) {
  if (!value.nextActionDate && (value.nextActionTime || value.nextActionNote)) {
    context.addIssue({ code: "custom", path: ["nextActionDate"], message: "Informe a data da próxima ação." });
  }
}

export const leadInputSchema = z
  .object({
    name: requiredText("o nome", 120, 2),
    phone: phoneSchema,
    email: optionalEmailSchema,
    source: z.enum(LeadSource, { error: "Selecione a origem." }),
    sourceDetail: optionalText("o complemento da origem", 120),
    interest: optionalText("o interesse", 200),
    procedureId: optionalUuidSchema,
    priority: z.preprocess(emptyToUndefined, z.enum(LeadPriority).default("MEDIUM")),
    ownerId: optionalUuidSchema,
    notes: optionalText("as observações", 2000),
    whatsappOptIn: checkboxSchema,
    ...nextActionFields,
  })
  .superRefine(refineNextAction);

export type LeadInput = z.output<typeof leadInputSchema>;

export const leadStatusChangeSchema = z
  .object({
    leadId: uuidSchema,
    status: z.enum(LeadStatus),
    lostReason: optionalText("o motivo da perda", 200),
  })
  .superRefine((value, context) => {
    if (value.status === "LOST" && !value.lostReason) {
      context.addIssue({ code: "custom", path: ["lostReason"], message: "Informe o motivo da perda." });
    }
  });

export type LeadStatusChange = z.output<typeof leadStatusChangeSchema>;

export const MANUAL_INTERACTION_TYPE_VALUES = ["CALL", "WHATSAPP", "EMAIL", "IN_PERSON", "NOTE"] as const;

export const interactionInputSchema = z
  .object({
    type: z.enum(MANUAL_INTERACTION_TYPE_VALUES, { error: "Selecione o tipo de interação." }),
    direction: z.preprocess(emptyToUndefined, z.enum(InteractionDirection).optional()),
    content: requiredText("a descrição", 2000, 2),
    occurredDate: optionalDateKeySchema,
    occurredTime: optionalTimeSchema,
    ...nextActionFields,
  })
  .superRefine(refineNextAction);

export type InteractionInput = z.output<typeof interactionInputSchema>;

export const leadConvertSchema = z
  .object({
    mode: z.enum(["create", "link"]),
    existingPatientId: optionalUuidSchema,
    fullName: requiredText("o nome completo", 120, 2),
    email: optionalEmailSchema,
    birthDate: optionalDateKeySchema,
    whatsappOptIn: checkboxSchema,
    /** Confirma a criação mesmo havendo paciente com o mesmo telefone (ex.: telefone compartilhado). */
    confirmDuplicatePhone: checkboxSchema,
  })
  .superRefine((value, context) => {
    if (value.mode === "link" && !value.existingPatientId) {
      context.addIssue({ code: "custom", path: ["existingPatientId"], message: "Selecione o paciente." });
    }
  });

export type LeadConvertInput = z.output<typeof leadConvertSchema>;


export const LEAD_SORTS = ["recentes", "antigos", "nome", "proxima_acao", "prioridade"] as const;

export const leadFiltersSchema = z.object({
  busca: z.preprocess(firstQueryValue, z.string().trim().max(80).optional()).catch(undefined),
  origem: z.preprocess(firstQueryValue, z.enum(LeadSource).optional()).catch(undefined),
  responsavel: z.preprocess(firstQueryValue, z.union([z.uuid(), z.literal("sem")]).optional()).catch(undefined),
  status: z.preprocess(firstQueryValue, z.enum(LeadStatus).optional()).catch(undefined),
  prioridade: z.preprocess(firstQueryValue, z.enum(LeadPriority).optional()).catch(undefined),
  ordem: z.preprocess(firstQueryValue, z.enum(LEAD_SORTS)).catch("recentes"),
  pagina: z.preprocess(firstQueryValue, pageSchema).catch(1),
  visao: z.preprocess(firstQueryValue, z.enum(["funil", "lista"])).catch("funil"),
});

export type LeadFilters = z.output<typeof leadFiltersSchema>;
