import { z } from "zod";

/** E-mails são comparados e armazenados sempre em minúsculas e sem espaços. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export const emailSchema = z
  .string({ error: "Informe o e-mail." })
  .trim()
  .min(1, { error: "Informe o e-mail." })
  .max(254, { error: "E-mail muito longo." })
  .pipe(z.email({ error: "Informe um e-mail válido." }))
  .transform(normalizeEmail);

/**
 * Formulário de login: não aplica regras de força de senha (isso revelaria a
 * política e não protege nada no login), apenas limites de tamanho.
 */
export const loginSchema = z.object({
  email: emailSchema,
  password: z
    .string({ error: "Informe a senha." })
    .min(1, { error: "Informe a senha." })
    .max(256, { error: "Senha muito longa." }),
  next: z.string().max(512).optional(),
});

export type LoginInput = z.infer<typeof loginSchema>;

/**
 * Política para definição de senhas da equipe (criação/alteração).
 * Segue a orientação do NIST SP 800-63B: comprimento mínimo alto, sem regras
 * de composição arbitrárias e com bloqueio de senhas óbvias.
 */
export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

const OBVIOUS_PASSWORDS = new Set([
  "123456789012",
  "senhasenhasenha",
  "password1234",
  "qwertyuiop12",
  "clinica12345",
  "daniela123456",
]);

export const newPasswordSchema = z
  .string({ error: "Informe a senha." })
  .min(PASSWORD_MIN_LENGTH, {
    error: `A senha deve ter pelo menos ${PASSWORD_MIN_LENGTH} caracteres.`,
  })
  .max(PASSWORD_MAX_LENGTH, {
    error: `A senha deve ter no máximo ${PASSWORD_MAX_LENGTH} caracteres.`,
  })
  .refine((value) => !OBVIOUS_PASSWORDS.has(value.toLowerCase()), {
    error: "Escolha uma senha menos previsível.",
  })
  .refine((value) => new Set(value).size >= 5, {
    error: "A senha precisa ter mais variedade de caracteres.",
  });
