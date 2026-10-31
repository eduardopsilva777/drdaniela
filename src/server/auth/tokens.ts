import { createHash, randomBytes } from "node:crypto";

/**
 * Tokens de sessão: 256 bits aleatórios (CSPRNG), codificados em base64url.
 * O banco guarda somente o SHA-256 do token — quem lê o banco não consegue
 * reconstruir um cookie válido.
 */

const TOKEN_BYTES = 32;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function generateSessionToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

export function isWellFormedSessionToken(token: unknown): token is string {
  return typeof token === "string" && TOKEN_PATTERN.test(token);
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
