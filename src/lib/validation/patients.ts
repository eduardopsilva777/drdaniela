import { z } from "zod";

import { LeadSource, NoteVisibility } from "@/generated/prisma/enums";

import {
  checkboxSchema,
  emptyToUndefined,
  firstQueryValue,
  optionalDateKeySchema,
  optionalEmailSchema,
  optionalText,
  pageSchema,
  phoneSchema,
  requiredText,
} from "./common";

export const patientInputSchema = z.object({
  fullName: requiredText("o nome completo", 120, 2),
  preferredName: optionalText("o nome social ou apelido", 60),
  phone: phoneSchema,
  email: optionalEmailSchema,
  birthDate: optionalDateKeySchema,
  source: z.preprocess(emptyToUndefined, z.enum(LeadSource).optional()),
  sourceDetail: optionalText("o complemento da origem", 120),
  whatsappOptIn: checkboxSchema,
  marketingOptIn: checkboxSchema,
  imageUseConsent: checkboxSchema,
  /** Confirma cadastro com telefone já usado por outro paciente (ex.: responsável). */
  allowDuplicatePhone: checkboxSchema,
});

export type PatientInput = z.output<typeof patientInputSchema>;

export const patientDeactivateSchema = z.object({
  reason: requiredText("o motivo", 200, 3),
});

export const patientNoteSchema = z.object({
  visibility: z.enum(NoteVisibility),
  content: requiredText("a observação", 4000, 2),
});

export type PatientNoteInput = z.output<typeof patientNoteSchema>;


export const PATIENT_TABS = [
  "resumo",
  "agenda",
  "procedimentos",
  "protocolos",
  "mensagens",
  "interacoes",
  "observacoes",
] as const;

export type PatientTab = (typeof PATIENT_TABS)[number];

export const patientFiltersSchema = z.object({
  busca: z.preprocess(firstQueryValue, z.string().trim().max(80).optional()).catch(undefined),
  situacao: z.preprocess(firstQueryValue, z.enum(["ativos", "inativos", "todos"])).catch("ativos"),
  ordem: z.preprocess(firstQueryValue, z.enum(["nome", "recentes", "antigos"])).catch("nome"),
  pagina: z.preprocess(firstQueryValue, pageSchema).catch(1),
});

export type PatientFilters = z.output<typeof patientFiltersSchema>;
