import { z } from "zod";

import { STAFF_ROLES } from "@/lib/auth/permissions";

import { emailSchema } from "./auth";
import { requiredText } from "./common";

/** Contas da equipe (gestão pela administração). */

export const staffInputSchema = z.object({
  name: requiredText("o nome", 120, 2),
  email: emailSchema,
  role: z.enum(STAFF_ROLES, { error: "Selecione o perfil de acesso." }),
});

export type StaffInput = z.output<typeof staffInputSchema>;

export const staffUpdateSchema = z.object({
  name: requiredText("o nome", 120, 2),
  role: z.enum(STAFF_ROLES, { error: "Selecione o perfil de acesso." }),
});

export type StaffUpdateInput = z.output<typeof staffUpdateSchema>;

export const passwordChangeSchema = z
  .object({
    currentPassword: z.string({ error: "Informe a senha atual." }).min(1, { error: "Informe a senha atual." }).max(256),
    newPassword: z.string({ error: "Informe a nova senha." }).min(1, { error: "Informe a nova senha." }).max(256),
    confirmation: z.string().max(256),
  })
  .superRefine((value, context) => {
    if (value.newPassword !== value.confirmation) {
      context.addIssue({ code: "custom", path: ["confirmation"], message: "As senhas não conferem." });
    }
  });
