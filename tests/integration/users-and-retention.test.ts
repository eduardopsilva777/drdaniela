import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { staffInputSchema } from "@/lib/validation/users";
import { authenticateWithPassword } from "@/server/auth/authenticate";
import { AuthorizationError } from "@/server/auth/errors";
import { DEFAULT_LOGIN_THROTTLE_POLICY } from "@/server/auth/login-throttle";
import { verifyPassword } from "@/server/auth/password";
import { createSession, validateSessionToken } from "@/server/auth/session-store";
import { DomainError } from "@/server/errors";
import { runRetention } from "@/server/maintenance/retention";
import {
  changeOwnPassword,
  createStaffAccount,
  generateTemporaryPassword,
  resetStaffPassword,
  setStaffActive,
  updateStaffAccount,
} from "@/server/services/users";

import { actorOf, createTeam, createTestDb, resetDatabase } from "./helpers";

const db = createTestDb();

beforeEach(() => resetDatabase(db));
afterAll(() => db.$disconnect());

const SESSION_POLICY = { maxAgeMs: 12 * 3_600_000, idleTimeoutMs: 2 * 3_600_000, touchIntervalMs: 60_000 };

describe("gestão da equipe", () => {
  it("só a administração cria contas; a senha provisória funciona e exige troca", async () => {
    const team = await createTeam(db);
    const input = staffInputSchema.parse({ name: "Nova Pessoa", email: "Nova@Clinica.test", role: "RECEPTION" });

    await expect(createStaffAccount(db, team.asProfessional, input)).rejects.toBeInstanceOf(AuthorizationError);

    const { id, temporaryPassword } = await createStaffAccount(db, team.asAdmin, input);
    expect(temporaryPassword).toMatch(/^[a-zA-Z2-9]{4}(-[a-zA-Z2-9]{4}){3}$/);

    const stored = await db.user.findUniqueOrThrow({ where: { id } });
    expect(stored).toMatchObject({ email: "nova@clinica.test", mustChangePassword: true, role: "RECEPTION" });
    expect(await verifyPassword(stored.passwordHash, temporaryPassword)).toBe(true);

    // O login funciona e sinaliza a troca obrigatória.
    const login = await authenticateWithPassword(
      db,
      { email: "nova@clinica.test", password: temporaryPassword, ipAddress: null, userAgent: null },
      { session: SESSION_POLICY, throttle: DEFAULT_LOGIN_THROTTLE_POLICY },
    );
    expect(login.ok && login.user.mustChangePassword).toBe(true);

    // A auditoria não guarda a senha.
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "user.create" } });
    expect(JSON.stringify(audit)).not.toContain(temporaryPassword);

    await expect(createStaffAccount(db, team.asAdmin, input)).rejects.toThrow(/Já existe uma conta/);
  });

  it("protege contra ficar sem administração e contra desativar a si mesmo", async () => {
    const team = await createTeam(db);
    await expect(setStaffActive(db, team.asAdmin, team.admin.id, false)).rejects.toThrow(/própria conta/);
    await expect(
      updateStaffAccount(db, team.asAdmin, team.admin.id, { name: "Helena Admin", role: "RECEPTION" }),
    ).rejects.toThrow(/ao menos uma conta de administração/);

    // Com outra administração ativa, rebaixar é permitido.
    await updateStaffAccount(db, team.asAdmin, team.professional.id, { name: "Daniela", role: "ADMIN" });
    await updateStaffAccount(db, team.asAdmin, team.admin.id, { name: "Helena Admin", role: "PROFESSIONAL" });
    expect((await db.user.findUniqueOrThrow({ where: { id: team.admin.id } })).role).toBe("PROFESSIONAL");
  });

  it("desativar encerra as sessões; a sessão deixa de ser aceita", async () => {
    const team = await createTeam(db);
    const { token } = await createSession(db, { userId: team.reception.id }, SESSION_POLICY);

    await setStaffActive(db, team.asAdmin, team.reception.id, false);
    expect(await db.session.count({ where: { userId: team.reception.id } })).toBe(0);
    expect(await validateSessionToken(db, token, SESSION_POLICY)).toBeNull();

    await setStaffActive(db, team.asAdmin, team.reception.id, true);
    expect((await db.user.findUniqueOrThrow({ where: { id: team.reception.id } })).isActive).toBe(true);
  });

  it("redefinir senha gera nova provisória e encerra as sessões", async () => {
    const team = await createTeam(db);
    await createSession(db, { userId: team.reception.id }, SESSION_POLICY);
    const { temporaryPassword } = await resetStaffPassword(db, team.asAdmin, team.reception.id);

    const stored = await db.user.findUniqueOrThrow({ where: { id: team.reception.id } });
    expect(stored.mustChangePassword).toBe(true);
    expect(await verifyPassword(stored.passwordHash, temporaryPassword)).toBe(true);
    expect(await db.session.count({ where: { userId: team.reception.id } })).toBe(0);
  });
});

describe("troca da própria senha", () => {
  it("confere a senha atual, aplica a política, limpa a pendência e encerra as outras sessões", async () => {
    const team = await createTeam(db);
    const { temporaryPassword } = await resetStaffPassword(db, team.asAdmin, team.reception.id);
    const current = await createSession(db, { userId: team.reception.id }, SESSION_POLICY);
    await createSession(db, { userId: team.reception.id }, SESSION_POLICY);
    const actor = actorOf(team.reception);

    const wrong = await changeOwnPassword(db, actor, { currentPassword: "errada", newPassword: "uma frase longa e segura" }, current.sessionId).catch(
      (caught: unknown) => caught,
    );
    expect((wrong as DomainError).code).toBe("wrong_password");
    await expect(
      changeOwnPassword(db, actor, { currentPassword: temporaryPassword, newPassword: "curta" }, current.sessionId),
    ).rejects.toThrow(/Escolha outra senha/);

    await changeOwnPassword(db, actor, { currentPassword: temporaryPassword, newPassword: "uma frase longa e segura" }, current.sessionId);
    const stored = await db.user.findUniqueOrThrow({ where: { id: team.reception.id } });
    expect(stored.mustChangePassword).toBe(false);
    expect(await verifyPassword(stored.passwordHash, "uma frase longa e segura")).toBe(true);

    const sessions = await db.session.findMany({ where: { userId: team.reception.id } });
    expect(sessions.map((session) => session.id)).toEqual([current.sessionId]);
  });

  it("limita as tentativas de senha atual, como no login", async () => {
    const team = await createTeam(db);
    const { temporaryPassword } = await resetStaffPassword(db, team.asAdmin, team.reception.id);
    const session = await createSession(db, { userId: team.reception.id }, SESSION_POLICY);
    const actor = actorOf(team.reception);
    const attempt = (currentPassword: string) =>
      changeOwnPassword(db, actor, { currentPassword, newPassword: "uma frase longa e segura" }, session.sessionId).catch(
        (caught: unknown) => caught as DomainError,
      );

    for (let index = 0; index < 5; index += 1) {
      expect((await attempt(`chute-${index}`))?.code).toBe("wrong_password");
    }
    // Bloqueado mesmo com a senha certa, e o bloqueio vale também para o login.
    expect((await attempt(temporaryPassword))?.code).toBe("too_many_attempts");
    const login = await authenticateWithPassword(
      db,
      { email: team.reception.email, password: temporaryPassword, ipAddress: null, userAgent: null },
      { session: SESSION_POLICY, throttle: DEFAULT_LOGIN_THROTTLE_POLICY },
    );
    expect(login).toMatchObject({ ok: false, reason: "blocked" });
    expect(await db.auditLog.count({ where: { action: "user.password.change.failure" } })).toBe(5);
  });

  it("senhas provisórias são aleatórias e legíveis", () => {
    const samples = new Set(Array.from({ length: 50 }, () => generateTemporaryPassword()));
    expect(samples.size).toBe(50);
    for (const sample of samples) expect(sample).not.toMatch(/[01lIoO]/);
  });
});

describe("retenção de dados técnicos", () => {
  it("simula por padrão e só apaga dados técnicos antigos ao aplicar", async () => {
    const team = await createTeam(db);
    const now = new Date("2026-11-02T12:00:00Z");
    const old = new Date("2026-07-01T12:00:00Z");
    await db.session.create({ data: { id: "a".repeat(64), userId: team.reception.id, expiresAt: new Date("2026-10-01T00:00:00Z") } });
    await db.session.create({ data: { id: "b".repeat(64), userId: team.reception.id, expiresAt: new Date("2026-11-03T00:00:00Z") } });
    await db.loginAttempt.createMany({
      data: [
        { email: "x@clinica.test", success: false, createdAt: old },
        { email: "x@clinica.test", success: true, createdAt: now },
      ],
    });
    await db.webhookEvent.create({ data: { provider: "cloud_api", eventKey: "msg:old", kind: "message", signatureValid: true, receivedAt: old } });
    await db.patient.create({ data: { fullName: "Paciente Antigo", phone: "+5511900001111", createdAt: old } });

    const dryRun = await runRetention(db, { apply: false, now });
    expect(dryRun).toEqual({ apply: false, expiredSessions: 1, loginAttempts: 1, webhookEvents: 1 });
    expect(await db.loginAttempt.count()).toBe(2);

    const applied = await runRetention(db, { apply: true, now });
    expect(applied).toMatchObject({ apply: true, expiredSessions: 1, loginAttempts: 1, webhookEvents: 1 });
    expect(await db.session.count()).toBe(1);
    expect(await db.loginAttempt.count()).toBe(1);
    expect(await db.webhookEvent.count()).toBe(0);
    expect(await db.patient.count()).toBe(1); // dados de pacientes nunca são apagados aqui
    expect(await db.auditLog.count({ where: { action: "data.retention.run" } })).toBe(1);
  });
});
