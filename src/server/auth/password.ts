import { argon2id, argon2Verify } from "hash-wasm";

/**
 * Hash de senhas com Argon2id (recomendação principal da OWASP).
 * Parâmetros: m = 19 MiB, t = 2, p = 1 — mínimo recomendado pelo
 * OWASP Password Storage Cheat Sheet, adequado a um servidor pequeno.
 *
 * Sem `server-only`: também é usado pelos scripts de criação de usuário e seed.
 */

export const PASSWORD_HASH_OPTIONS = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
  saltLength: 16,
} as const;

export async function hashPassword(password: string): Promise<string> {
  const salt = new Uint8Array(PASSWORD_HASH_OPTIONS.saltLength);
  globalThis.crypto.getRandomValues(salt);
  return argon2id({
    password,
    salt,
    parallelism: PASSWORD_HASH_OPTIONS.parallelism,
    iterations: PASSWORD_HASH_OPTIONS.timeCost,
    memorySize: PASSWORD_HASH_OPTIONS.memoryCost,
    hashLength: PASSWORD_HASH_OPTIONS.outputLen,
    outputType: "encoded",
  });
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await argon2Verify({ password, hash: passwordHash });
  } catch {
    // Hash malformado ou de outro algoritmo: trata como senha incorreta.
    return false;
  }
}

/** Indica se o hash foi gerado com parâmetros mais fracos que os atuais. */
export function passwordNeedsRehash(passwordHash: string): boolean {
  try {
    const current = parseArgon2Options(passwordHash);
    return (
      current.memoryCost < PASSWORD_HASH_OPTIONS.memoryCost ||
      current.timeCost < PASSWORD_HASH_OPTIONS.timeCost ||
      current.parallelism !== PASSWORD_HASH_OPTIONS.parallelism
    );
  } catch {
    return true;
  }
}

let dummyHash: Promise<string> | undefined;

function parseArgon2Options(passwordHash: string): {
  memoryCost: number;
  timeCost: number;
  parallelism: number;
} {
  const match = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$/.exec(passwordHash);
  if (!match) throw new Error("hash Argon2id inválido");
  return {
    memoryCost: Number(match[1]),
    timeCost: Number(match[2]),
    parallelism: Number(match[3]),
  };
}

/**
 * Executa uma verificação de custo equivalente quando o e-mail não existe,
 * para que o tempo de resposta não revele quais e-mails estão cadastrados.
 */
export async function burnPasswordVerification(password: string): Promise<false> {
  dummyHash ??= hashPassword(globalThis.crypto.randomUUID());
  await verifyPassword(await dummyHash, password);
  return false;
}
