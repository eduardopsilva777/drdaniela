import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Cifragem de campos sensíveis (observações de pacientes) com AES-256-GCM.
 *
 * Formato: "v1:<iv>:<tag>:<conteúdo>" (base64url). O contexto (ex.: o id do
 * paciente) entra como dado autenticado: um texto cifrado copiado para outro
 * registro não é aceito na leitura.
 *
 * Rotação de chave: grava-se sempre com a chave atual; a leitura tenta a atual
 * e depois as anteriores (o GCM autentica — a chave errada nunca "decifra" lixo).
 * A recifragem para a chave nova é feita por `npm run data:rotate-key`.
 *
 * Sem `server-only`: também usado pelos scripts de manutenção.
 */

const VERSION = "v1";
const ALGORITHM = "aes-256-gcm";

export class EncryptionKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EncryptionKeyError";
  }
}

export interface Keyring {
  /** Chave usada para gravar (e tentada primeiro na leitura). */
  current: Buffer;
  /** Chaves antigas aceitas apenas na leitura, durante uma rotação. */
  previous: Buffer[];
}

export function parseEncryptionKey(base64: string | undefined, name = "DATA_ENCRYPTION_KEY"): Buffer {
  if (!base64) {
    throw new EncryptionKeyError(`${name} não configurada. Gere uma com: openssl rand -base64 32`);
  }
  const key = Buffer.from(base64, "base64");
  if (key.length !== 32) {
    throw new EncryptionKeyError(`${name} deve conter exatamente 32 bytes em base64.`);
  }
  return key;
}

/** Aceita uma chave única (testes, gravação) ou o chaveiro completo. */
export function toKeyring(keys: Buffer | Keyring): Keyring {
  return Buffer.isBuffer(keys) ? { current: keys, previous: [] } : keys;
}

/** Contexto autenticado das observações: o texto só é aceito no paciente de origem. */
export function noteContext(patientId: string): string {
  return `patient_note:${patientId}`;
}

export function encryptField(plaintext: string, key: Buffer, context: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(Buffer.from(context, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(":");
}

export function decryptField(payload: string, key: Buffer, context: string): string {
  const [version, iv, tag, ciphertext] = payload.split(":");
  if (version !== VERSION || !iv || !tag || ciphertext === undefined) {
    throw new Error("Conteúdo cifrado em formato desconhecido.");
  }
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv, "base64url"));
  decipher.setAAD(Buffer.from(context, "utf8"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
}

/**
 * Decifra com a chave atual ou, durante uma rotação, com uma anterior.
 * `usedPrevious` indica que o registro ainda precisa ser recifrado.
 */
export function decryptWithKeyring(
  payload: string,
  keys: Buffer | Keyring,
  context: string,
): { plaintext: string; usedPrevious: boolean } {
  const keyring = toKeyring(keys);
  try {
    return { plaintext: decryptField(payload, keyring.current, context), usedPrevious: false };
  } catch (error) {
    for (const key of keyring.previous) {
      try {
        return { plaintext: decryptField(payload, key, context), usedPrevious: true };
      } catch {
        // tenta a próxima chave
      }
    }
    throw error;
  }
}
