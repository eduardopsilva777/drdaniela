import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { authenticateWithPassword } from "@/server/auth/authenticate";
import { DEFAULT_LOGIN_THROTTLE_POLICY, type LoginThrottlePolicy } from "@/server/auth/login-throttle";
import { validateSessionToken, type SessionPolicy } from "@/server/auth/session-store";

import { createTestDb, createTestUser, resetDatabase, TEST_PASSWORD } from "./helpers";

const db = createTestDb();
const session: SessionPolicy = { maxAgeMs: 12 * 3_600_000, idleTimeoutMs: 7_200_000, touchIntervalMs: 60_000 };
const throttle: LoginThrottlePolicy = { ...DEFAULT_LOGIN_THROTTLE_POLICY };
const policies = { session, throttle };
const t0 = new Date("2026-11-03T12:00:00Z");
const at = (ms: number) => new Date(t0.getTime() + ms);
const meta = { ipAddress: "203.0.113.10", userAgent: "vitest" };

function attempt(email: string, password: string, now: Date, overrides: Partial<typeof meta> = {}) {
  return authenticateWithPassword(db, { email, password, ...meta, ...overrides }, policies, now);
}

beforeEach(() => resetDatabase(db));
afterAll(() => db.$disconnect());

describe("login com e-mail e senha", () => {
  it("cria sessão válida, registra a tentativa, o último acesso e a auditoria", async () => {
    const user = await createTestUser(db, { email: "daniela@clinica.test", role: "ADMIN" });

    const result = await attempt("  Daniela@Clinica.TEST ", TEST_PASSWORD, t0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const validated = await validateSessionToken(db, result.session.token, session, at(1000));
    expect(validated?.user.id).toBe(user.id);

    const refreshed = await db.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(refreshed.lastLoginAt).toEqual(t0);

    const audit = await db.auditLog.findMany({ where: { action: "auth.login.success" } });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actorId: user.id, ipAddress: meta.ipAddress, userAgent: "vitest" });

    await expect(db.loginAttempt.count({ where: { success: true } })).resolves.toBe(1);
  });

  it("responde igual para senha errada, e-mail inexistente e usuário desativado", async () => {
    await createTestUser(db, { email: "ativa@clinica.test" });
    await createTestUser(db, { email: "inativa@clinica.test", isActive: false });

    const wrongPassword = await attempt("ativa@clinica.test", "senha-errada", t0);
    const unknownEmail = await attempt("ninguem@clinica.test", TEST_PASSWORD, t0);
    const inactiveUser = await attempt("inativa@clinica.test", TEST_PASSWORD, t0);

    for (const result of [wrongPassword, unknownEmail, inactiveUser]) {
      expect(result).toEqual({ ok: false, reason: "invalid_credentials" });
    }
    await expect(db.session.count()).resolves.toBe(0);

    // O motivo real fica apenas na auditoria, para a administração.
    const reasons = (
      await db.auditLog.findMany({ where: { action: "auth.login.failure" }, orderBy: { createdAt: "asc" } })
    ).map((entry) => (entry.metadata as { reason: string }).reason);
    expect(reasons.sort()).toEqual(["inactive_user", "unknown_user", "wrong_password"]);
  });

  it("bloqueia após 5 falhas no mesmo e-mail, por 15 minutos a partir da primeira falha contada", async () => {
    await createTestUser(db, { email: "alvo@clinica.test" });

    for (let index = 0; index < 5; index += 1) {
      const failed = await attempt("alvo@clinica.test", "errada", at(index * 60_000));
      expect(failed).toEqual({ ok: false, reason: "invalid_credentials" });
    }

    // Mesmo com a senha correta, o login fica bloqueado.
    const blocked = await attempt("alvo@clinica.test", TEST_PASSWORD, at(5 * 60_000));
    expect(blocked).toEqual({ ok: false, reason: "blocked", retryAfterSeconds: 600 });
    await expect(db.auditLog.count({ where: { action: "auth.login.blocked" } })).resolves.toBe(1);

    // Tentativas bloqueadas não são contadas como novas falhas.
    await expect(db.loginAttempt.count({ where: { success: false } })).resolves.toBe(5);

    // Quando a falha mais antiga sai da janela, o login volta a ser possível.
    const afterWindow = await attempt("alvo@clinica.test", TEST_PASSWORD, at(15 * 60_000 + 1000));
    expect(afterWindow.ok).toBe(true);
  });

  it("um login bem-sucedido zera a contagem de falhas do e-mail", async () => {
    await createTestUser(db, { email: "zera@clinica.test" });
    for (let index = 0; index < 4; index += 1) {
      await attempt("zera@clinica.test", "errada", at(index * 1000));
    }
    expect((await attempt("zera@clinica.test", TEST_PASSWORD, at(5000))).ok).toBe(true);
    for (let index = 0; index < 4; index += 1) {
      await attempt("zera@clinica.test", "errada", at(6000 + index * 1000));
    }
    expect((await attempt("zera@clinica.test", TEST_PASSWORD, at(11_000))).ok).toBe(true);
  });

  it("o bloqueio por e-mail não afeta outras contas", async () => {
    await createTestUser(db, { email: "a@clinica.test" });
    await createTestUser(db, { email: "b@clinica.test" });
    for (let index = 0; index < 5; index += 1) {
      await attempt("a@clinica.test", "errada", at(index * 1000));
    }
    expect((await attempt("a@clinica.test", TEST_PASSWORD, at(6000))).ok).toBe(false);
    expect((await attempt("b@clinica.test", TEST_PASSWORD, at(6000))).ok).toBe(true);
  });

  it("limite por IP só vale quando o IP é confiável (TRUST_PROXY)", async () => {
    await createTestUser(db, { email: "vitima@clinica.test" });
    const spray = async (start: number) => {
      for (let index = 0; index < 20; index += 1) {
        await attempt(`inexistente-${start + index}@clinica.test`, "x", at(start + index));
      }
    };

    await spray(0);
    expect((await attempt("vitima@clinica.test", TEST_PASSWORD, at(100))).ok).toBe(true);

    const withIpLimit = { session, throttle: { ...throttle, ipLimitEnabled: true } };
    await spray(200);
    const blocked = await authenticateWithPassword(
      db,
      { email: "vitima@clinica.test", password: TEST_PASSWORD, ...meta },
      withIpLimit,
      at(300),
    );
    expect(blocked).toMatchObject({ ok: false, reason: "blocked" });

    const otherIp = await authenticateWithPassword(
      db,
      { email: "vitima@clinica.test", password: TEST_PASSWORD, ...meta, ipAddress: "198.51.100.20" },
      withIpLimit,
      at(300),
    );
    expect(otherIp.ok).toBe(true);
  });
});
