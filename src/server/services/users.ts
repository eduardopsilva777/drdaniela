import "server-only";

import { randomInt } from "node:crypto";

import type { UserRole } from "@/generated/prisma/enums";
import { newPasswordSchema } from "@/lib/validation/auth";
import type { StaffInput, StaffUpdateInput } from "@/lib/validation/users";
import { recordAudit } from "@/server/audit";
import {
  checkLoginThrottle,
  DEFAULT_LOGIN_THROTTLE_POLICY,
  recordLoginAttempt,
  type LoginThrottlePolicy,
} from "@/server/auth/login-throttle";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { invalidateUserSessions } from "@/server/auth/session-store";
import type { DbClient, DbExecutor } from "@/server/db/prisma";
import { DomainError, isUniqueViolation, NotFoundError } from "@/server/errors";

import { assertPermission, auditContext, type Actor } from "./context";

/**
 * Gestão das contas da equipe pela administração.
 * - Contas novas e senhas redefinidas recebem uma senha provisória aleatória,
 *   exibida uma única vez; a troca é exigida no primeiro acesso.
 * - Contas não são excluídas (preservam a auditoria): são desativadas.
 * - Ninguém desativa a própria conta, e sempre resta ao menos uma administração ativa.
 */

/** Sem caracteres ambíguos (0/O, 1/l/I), para ditar ou digitar sem erro. */
const ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generateTemporaryPassword(length = 16): string {
  let password = "";
  for (let index = 0; index < length; index += 1) password += ALPHABET[randomInt(ALPHABET.length)];
  // Grupos de 4 facilitam a leitura; a política aceita (16 letras/dígitos + hífens).
  return password.match(/.{1,4}/g)!.join("-");
}

async function assertKeepsAnAdmin(db: DbExecutor, userId: string, change: { role?: UserRole; active?: boolean }) {
  const user = await db.user.findUnique({ where: { id: userId }, select: { role: true, isActive: true } });
  if (!user || user.role !== "ADMIN" || !user.isActive) return;
  const losesAdmin = (change.role !== undefined && change.role !== "ADMIN") || change.active === false;
  if (!losesAdmin) return;
  const otherAdmins = await db.user.count({ where: { role: "ADMIN", isActive: true, id: { not: userId } } });
  if (otherAdmins === 0) {
    throw new DomainError("É preciso manter ao menos uma conta de administração ativa.", { code: "last_admin" });
  }
}

export async function createStaffAccount(db: DbClient, actor: Actor, input: StaffInput) {
  assertPermission(actor, "users:manage");
  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);
  try {
    const user = await db.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: { name: input.name, email: input.email, role: input.role, passwordHash, mustChangePassword: true },
        select: { id: true },
      });
      await recordAudit(tx, {
        ...auditContext(actor),
        action: "user.create",
        entityType: "user",
        entityId: created.id,
        metadata: { source: "admin", role: input.role },
      });
      return created;
    });
    return { id: user.id, temporaryPassword };
  } catch (error) {
    if (isUniqueViolation(error, "email")) {
      const message = "Já existe uma conta com este e-mail.";
      throw new DomainError(message, { code: "duplicate_email", fieldErrors: { email: [message] } });
    }
    throw error;
  }
}

export async function updateStaffAccount(db: DbClient, actor: Actor, userId: string, input: StaffUpdateInput) {
  assertPermission(actor, "users:manage");
  return db.$transaction(async (tx) => {
    const current = await tx.user.findUnique({ where: { id: userId }, select: { id: true, role: true } });
    // A conta de sistema do assistente virtual não é gerenciada pela tela de equipe.
    if (!current || current.role === "ASSISTANT") throw new NotFoundError("Conta");
    await assertKeepsAnAdmin(tx, userId, { role: input.role });
    await tx.user.update({ where: { id: userId }, data: { name: input.name, role: input.role } });
    await recordAudit(tx, {
      ...auditContext(actor),
      action: "user.update",
      entityType: "user",
      entityId: userId,
      metadata: { source: "admin", role: input.role, roleChanged: current.role !== input.role },
    });
  });
}

export async function setStaffActive(db: DbClient, actor: Actor, userId: string, active: boolean) {
  assertPermission(actor, "users:manage");
  if (userId === actor.id && !active) {
    throw new DomainError("Você não pode desativar a própria conta.", { code: "self_deactivation" });
  }
  return db.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true, isActive: true, role: true } });
    if (!user || user.role === "ASSISTANT") throw new NotFoundError("Conta");
    if (user.isActive === active) return;
    await assertKeepsAnAdmin(tx, userId, { active });
    await tx.user.update({ where: { id: userId }, data: { isActive: active } });
    // Desativar encerra imediatamente todas as sessões abertas.
    const closedSessions = active ? 0 : await invalidateUserSessions(tx, userId);
    await recordAudit(tx, {
      ...auditContext(actor),
      action: active ? "user.activate" : "user.deactivate",
      entityType: "user",
      entityId: userId,
      metadata: { source: "admin", closedSessions },
    });
  });
}

export async function resetStaffPassword(db: DbClient, actor: Actor, userId: string, now: Date = new Date()) {
  assertPermission(actor, "users:manage");
  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);
  await db.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true, role: true } });
    if (!user || user.role === "ASSISTANT") throw new NotFoundError("Conta");
    await tx.user.update({
      where: { id: userId },
      data: { passwordHash, passwordChangedAt: now, mustChangePassword: true },
    });
    const closedSessions = await invalidateUserSessions(tx, userId);
    await recordAudit(tx, {
      ...auditContext(actor),
      action: "user.password.reset",
      entityType: "user",
      entityId: userId,
      metadata: { source: "admin", closedSessions },
    });
  });
  return { temporaryPassword };
}

/**
 * A própria pessoa troca a senha (obrigatório após senha provisória). Confere a
 * senha atual — com o mesmo limite de tentativas do login, para uma sessão
 * sequestrada não servir de atalho para adivinhar a senha — e encerra as
 * demais sessões, mantendo a atual.
 */
export async function changeOwnPassword(
  db: DbClient,
  actor: Actor,
  input: { currentPassword: string; newPassword: string },
  currentSessionId: string,
  now: Date = new Date(),
  throttle: LoginThrottlePolicy = DEFAULT_LOGIN_THROTTLE_POLICY,
) {
  const user = await db.user.findUnique({ where: { id: actor.id }, select: { id: true, email: true, passwordHash: true } });
  if (!user) throw new NotFoundError("Conta");
  const ipAddress = actor.ipAddress ?? null;

  const decision = await checkLoginThrottle(db, { email: user.email, ipAddress }, throttle, now);
  if (!decision.allowed) {
    const minutes = Math.ceil(decision.retryAfterSeconds / 60);
    throw new DomainError(
      `Muitas tentativas sem sucesso. Aguarde ${minutes} ${minutes === 1 ? "minuto" : "minutos"} e tente de novo.`,
      { code: "too_many_attempts" },
    );
  }
  if (!(await verifyPassword(user.passwordHash, input.currentPassword))) {
    // Conta como tentativa de autenticação sem sucesso (vale também para o login).
    await db.$transaction(async (tx) => {
      await recordLoginAttempt(tx, { email: user.email, ipAddress, success: false }, now);
      await recordAudit(tx, {
        ...auditContext(actor),
        action: "user.password.change.failure",
        entityType: "user",
        entityId: actor.id,
      });
    });
    const message = "Senha atual incorreta.";
    throw new DomainError(message, { code: "wrong_password", fieldErrors: { currentPassword: [message] } });
  }
  const parsed = newPasswordSchema.safeParse(input.newPassword);
  if (!parsed.success) {
    throw new DomainError("Escolha outra senha.", { fieldErrors: { newPassword: parsed.error.issues.map((issue) => issue.message) } });
  }
  if (input.newPassword === input.currentPassword) {
    const message = "A nova senha precisa ser diferente da atual.";
    throw new DomainError(message, { fieldErrors: { newPassword: [message] } });
  }

  const passwordHash = await hashPassword(input.newPassword);
  await db.$transaction(async (tx) => {
    await recordLoginAttempt(tx, { email: user.email, ipAddress, success: true }, now);
    await tx.user.update({
      where: { id: actor.id },
      data: { passwordHash, passwordChangedAt: now, mustChangePassword: false },
    });
    const closed = await tx.session.deleteMany({ where: { userId: actor.id, id: { not: currentSessionId } } });
    await recordAudit(tx, {
      ...auditContext(actor),
      action: "user.password.change",
      entityType: "user",
      entityId: actor.id,
      metadata: { closedSessions: closed.count },
    });
  });
}
