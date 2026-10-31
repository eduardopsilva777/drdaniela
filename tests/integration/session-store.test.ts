import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  createSession,
  deleteExpiredSessions,
  invalidateSession,
  invalidateUserSessions,
  validateSessionToken,
  type SessionPolicy,
} from "@/server/auth/session-store";
import { hashSessionToken } from "@/server/auth/tokens";

import { createTestDb, createTestUser, resetDatabase } from "./helpers";

const db = createTestDb();
const HOUR = 60 * 60 * 1000;
const policy: SessionPolicy = { maxAgeMs: 12 * HOUR, idleTimeoutMs: 2 * HOUR, touchIntervalMs: 60_000 };
const t0 = new Date("2026-11-03T12:00:00Z");
const at = (ms: number) => new Date(t0.getTime() + ms);

beforeEach(() => resetDatabase(db));
afterAll(() => db.$disconnect());

describe("sessões no banco", () => {
  it("cria sessão guardando somente o hash do token e valida o token correto", async () => {
    const user = await createTestUser(db, { name: "Ana Teste", role: "PROFESSIONAL" });
    const { token, sessionId, expiresAt } = await createSession(db, { userId: user.id }, policy, t0);

    const stored = await db.session.findUniqueOrThrow({ where: { id: sessionId } });
    expect(stored.id).toBe(hashSessionToken(token));
    expect(JSON.stringify(stored)).not.toContain(token);
    expect(expiresAt).toEqual(at(12 * HOUR));

    const validated = await validateSessionToken(db, token, policy, at(10 * 60_000));
    expect(validated?.user).toEqual({
      id: user.id,
      name: "Ana Teste",
      email: user.email,
      role: "PROFESSIONAL",
    });
  });

  it("rejeita token desconhecido ou malformado", async () => {
    await expect(validateSessionToken(db, "x".repeat(43), policy, t0)).resolves.toBeNull();
    await expect(validateSessionToken(db, "malformado", policy, t0)).resolves.toBeNull();
    await expect(validateSessionToken(db, undefined, policy, t0)).resolves.toBeNull();
  });

  it("expira após a duração máxima, mesmo com atividade, e remove a sessão", async () => {
    const user = await createTestUser(db);
    const { token, sessionId } = await createSession(db, { userId: user.id }, policy, t0);

    for (let hour = 1; hour < 12; hour += 1) {
      expect(await validateSessionToken(db, token, policy, at(hour * HOUR))).not.toBeNull();
    }
    await expect(validateSessionToken(db, token, policy, at(12 * HOUR))).resolves.toBeNull();
    await expect(db.session.count({ where: { id: sessionId } })).resolves.toBe(0);
  });

  it("encerra a sessão após o tempo máximo sem atividade", async () => {
    const user = await createTestUser(db);
    const { token } = await createSession(db, { userId: user.id }, policy, t0);

    expect(await validateSessionToken(db, token, policy, at(2 * HOUR - 1000))).not.toBeNull();
    // A validação acima renovou a atividade; 2h sem uso a partir dela encerram a sessão.
    await expect(validateSessionToken(db, token, policy, at(4 * HOUR))).resolves.toBeNull();
  });

  it("renova a atividade no máximo uma vez por intervalo", async () => {
    const user = await createTestUser(db);
    const { token, sessionId } = await createSession(db, { userId: user.id }, policy, t0);

    await validateSessionToken(db, token, policy, at(30_000));
    let stored = await db.session.findUniqueOrThrow({ where: { id: sessionId } });
    expect(stored.lastActiveAt).toEqual(t0);

    await validateSessionToken(db, token, policy, at(90_000));
    stored = await db.session.findUniqueOrThrow({ where: { id: sessionId } });
    expect(stored.lastActiveAt).toEqual(at(90_000));
  });

  it("invalida sessões de usuários desativados", async () => {
    const user = await createTestUser(db);
    const { token } = await createSession(db, { userId: user.id }, policy, t0);
    await db.user.update({ where: { id: user.id }, data: { isActive: false } });
    await expect(validateSessionToken(db, token, policy, at(1000))).resolves.toBeNull();
  });

  it("encerra uma sessão, todas as sessões de um usuário e as expiradas", async () => {
    const ana = await createTestUser(db);
    const bia = await createTestUser(db);
    const first = await createSession(db, { userId: ana.id }, policy, t0);
    const second = await createSession(db, { userId: ana.id }, policy, t0);
    const other = await createSession(db, { userId: bia.id }, policy, t0);

    await invalidateSession(db, first.sessionId);
    await expect(validateSessionToken(db, first.token, policy, t0)).resolves.toBeNull();
    await expect(validateSessionToken(db, second.token, policy, t0)).resolves.not.toBeNull();

    await expect(invalidateUserSessions(db, ana.id)).resolves.toBe(1);
    await expect(validateSessionToken(db, second.token, policy, t0)).resolves.toBeNull();
    await expect(validateSessionToken(db, other.token, policy, t0)).resolves.not.toBeNull();

    await expect(deleteExpiredSessions(db, at(13 * HOUR))).resolves.toBe(1);
  });
});
