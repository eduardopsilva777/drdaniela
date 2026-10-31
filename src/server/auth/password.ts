import { randomBytes } from "node:crypto";

import { hash, parseOptions, verify, type Algorithm, type Options } from "@node-rs/argon2";

/**
 * Hash de senhas com Argon2id (recomendação principal da OWASP).
 * Parâmetros: m = 19 MiB, t = 2, p = 1 — mínimo recomendado pelo
 * OWASP Password Storage Cheat Sheet, adequado a um servidor pequeno.
 *
 * Sem `server-only`: também é usado pelos scripts de criação de usuário e seed.
 */

// `Algorithm` é um const enum ambiente (incompatível com isolatedModules): 2 = Argon2id.
const ARGON2ID = 2 as Algorithm;

export const PASSWORD_HASH_OPTIONS = {
  algorithm: ARGON2ID,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
} as const satisfies Options;

export async function hashPassword(password: string): Promise<string> {
  return hash(password, PASSWORD_HASH_OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    // Hash malformado ou de outro algoritmo: trata como senha incorreta.
    return false;
  }
}

/** Indica se o hash foi gerado com parâmetros mais fracos que os atuais. */
export function passwordNeedsRehash(passwordHash: string): boolean {
  try {
    const current = parseOptions(passwordHash);
    return (
      current.algorithm !== PASSWORD_HASH_OPTIONS.algorithm ||
      current.memoryCost < PASSWORD_HASH_OPTIONS.memoryCost ||
      current.timeCost < PASSWORD_HASH_OPTIONS.timeCost
    );
  } catch {
    return true;
  }
}

let dummyHash: Promise<string> | undefined;

/**
 * Executa uma verificação de custo equivalente quando o e-mail não existe,
 * para que o tempo de resposta não revele quais e-mails estão cadastrados.
 */
export async function burnPasswordVerification(password: string): Promise<false> {
  dummyHash ??= hashPassword(randomBytes(32).toString("base64url"));
  await verifyPassword(await dummyHash, password);
  return false;
}
