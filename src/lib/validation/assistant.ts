import { z } from "zod";

import {
  FollowUpAction,
  KnowledgeCategory,
  ProtocolStepKind,
  TemplateCategory,
  TemplateStatus,
  TemplateUsage,
} from "@/generated/prisma/enums";
import { TEMPLATE_PARAMETERS } from "@/lib/labels";

import { checkboxSchema, emptyToUndefined, firstQueryValue, optionalText, optionalUuidSchema, pageSchema, requiredText } from "./common";

/** Assistente virtual: base de conhecimento, modelos da Meta, acompanhamento e filtros. */

export const knowledgeEntryInputSchema = z.object({
  category: z.enum(KnowledgeCategory, { error: "Selecione a categoria." }),
  procedureId: optionalUuidSchema,
  title: requiredText("a pergunta ou o tema", 160, 3),
  content: requiredText("a resposta aprovada", 2000, 5),
  keywords: z.preprocess((value) => (typeof value === "string" ? value : ""), z.string().trim().max(300, { error: "Use no máximo 300 caracteres." })),
  changeNote: optionalText("o motivo da alteração", 200),
  /** Envia direto para aprovação (senão fica como rascunho). */
  submit: checkboxSchema,
  /** Pendência de curadoria que esta resposta resolve. */
  gapId: optionalUuidSchema,
});

export type KnowledgeEntryInput = z.output<typeof knowledgeEntryInputSchema>;

export const knowledgeReviewSchema = z.object({
  note: optionalText("a observação", 300),
});

export const knowledgeRejectSchema = z.object({
  note: requiredText("o motivo da recusa", 300, 3),
});

export const knowledgeTestSchema = z.object({
  question: requiredText("a pergunta", 500, 3),
  includeDrafts: checkboxSchema,
});

export const gapFeedbackSchema = z.object({
  note: optionalText("o comentário", 300),
});

const placeholderCount = (body: string) => new Set([...body.matchAll(/\{\{(\d+)\}\}/g)].map((match) => match[1])).size;

export const templateInputSchema = z
  .object({
    name: z
      .string({ error: "Informe o nome do modelo." })
      .trim()
      .regex(/^[a-z0-9_]{1,512}$/, { error: "Use o nome exato da Meta: letras minúsculas, números e _." }),
    language: z
      .string()
      .trim()
      .regex(/^[a-z]{2}(_[A-Z]{2})?$/, { error: "Idioma no formato da Meta (ex.: pt_BR)." }),
    category: z.enum(TemplateCategory, { error: "Selecione a categoria." }),
    usage: z.enum(TemplateUsage, { error: "Selecione o uso." }),
    body: requiredText("o texto do modelo", 1024, 5),
    parameters: z.array(z.enum(TEMPLATE_PARAMETERS)).max(10),
  })
  .superRefine((value, context) => {
    if (placeholderCount(value.body) !== value.parameters.length) {
      context.addIssue({
        code: "custom",
        path: ["parameters"],
        message: "Informe um parâmetro para cada marcador {{1}}, {{2}}… do texto, na ordem.",
      });
    }
  });

export type TemplateInput = z.output<typeof templateInputSchema>;

export const templateStatusSchema = z.object({
  status: z.enum(TemplateStatus),
  reason: optionalText("o motivo", 300),
});

export const followUpRuleInputSchema = z
  .object({
    daysBefore: z.coerce.number().int().min(0, { error: "Use de 0 a 365 dias." }).max(365, { error: "Use de 0 a 365 dias." }),
    action: z.enum(FollowUpAction),
    templateId: z.preprocess(emptyToUndefined, z.uuid().optional()),
    taskTitle: optionalText("o título da tarefa", 120),
    stepKinds: z.array(z.enum(ProtocolStepKind)).max(3).default([]),
  })
  .superRefine((value, context) => {
    if (value.action === "MESSAGE" && !value.templateId) {
      context.addIssue({ code: "custom", path: ["templateId"], message: "Escolha o modelo aprovado da mensagem." });
    }
    if (value.action === "TASK" && !value.taskTitle) {
      context.addIssue({ code: "custom", path: ["taskTitle"], message: "Descreva a tarefa da equipe." });
    }
  });

export type FollowUpRuleInput = z.output<typeof followUpRuleInputSchema>;

export const followUpRulesSchema = z
  .array(followUpRuleInputSchema)
  .max(10, { error: "Use no máximo 10 regras de acompanhamento." })
  .superRefine((rules, context) => {
    const seen = new Set<string>();
    for (const rule of rules) {
      const key = `${rule.daysBefore}:${rule.action}`;
      if (seen.has(key)) {
        context.addIssue({ code: "custom", message: "Há duas regras iguais (mesmo número de dias e mesma ação)." });
        return;
      }
      seen.add(key);
    }
  });

export const ASSISTANT_TABS = [
  "visao-geral",
  "conhecimento",
  "pendencias",
  "configuracoes",
  "modelos",
  "consentimentos",
  "registros",
] as const;

export type AssistantTab = (typeof ASSISTANT_TABS)[number];

export const assistantFiltersSchema = z.object({
  aba: z.preprocess(firstQueryValue, z.enum(ASSISTANT_TABS)).catch("visao-geral"),
  periodo: z.preprocess(firstQueryValue, z.enum(["7", "30", "90"])).catch("30"),
  categoria: z.preprocess(firstQueryValue, z.enum(KnowledgeCategory).optional()).catch(undefined),
  situacao: z.preprocess(firstQueryValue, z.enum(["publicadas", "revisao", "rascunhos", "arquivadas"]).optional()).catch(undefined),
  busca: z.preprocess(firstQueryValue, z.string().trim().max(80).optional()).catch(undefined),
  pagina: z.preprocess(firstQueryValue, pageSchema).catch(1),
});

export type AssistantFilters = z.output<typeof assistantFiltersSchema>;

export const INBOX_FILTERS = ["todas", "equipe", "assistente", "nao-lidas", "descadastrados"] as const;

export const inboxFiltersSchema = z.object({
  filtro: z.preprocess(firstQueryValue, z.enum(INBOX_FILTERS)).catch("todas"),
  busca: z.preprocess(firstQueryValue, z.string().trim().max(80).optional()).catch(undefined),
  conversa: z.preprocess(firstQueryValue, z.uuid().optional()).catch(undefined),
});

export const taskFiltersSchema = z.object({
  situacao: z.preprocess(firstQueryValue, z.enum(["abertas", "encerradas"])).catch("abertas"),
  tipo: z.preprocess(firstQueryValue, z.enum(["HANDOFF", "QUALIFIED_LEAD", "FOLLOW_UP", "AUTOMATION_FAILURE"]).optional()).catch(undefined),
  pagina: z.preprocess(firstQueryValue, pageSchema).catch(1),
});

export type TaskFilters = z.output<typeof taskFiltersSchema>;
