import "server-only";

import { getServerEnv } from "@/server/env";

import { parseEncryptionKey, type Keyring } from "./field-encryption";

let cachedKeyring: Keyring | undefined;

/**
 * Chaves de cifragem das observações. A atual (DATA_ENCRYPTION_KEY) grava e lê;
 * a anterior (DATA_ENCRYPTION_KEY_PREVIOUS), se definida durante uma rotação,
 * só é usada para ler. Lança erro claro se a chave atual não estiver configurada.
 */
export function getNoteKeyring(): Keyring {
  if (!cachedKeyring) {
    const env = getServerEnv();
    cachedKeyring = {
      current: parseEncryptionKey(env.DATA_ENCRYPTION_KEY),
      previous: env.DATA_ENCRYPTION_KEY_PREVIOUS
        ? [parseEncryptionKey(env.DATA_ENCRYPTION_KEY_PREVIOUS, "DATA_ENCRYPTION_KEY_PREVIOUS")]
        : [],
    };
  }
  return cachedKeyring;
}

/** Chave usada para gravar novas observações. */
export function getNoteEncryptionKey(): Buffer {
  return getNoteKeyring().current;
}

export function isNoteEncryptionConfigured(): boolean {
  return Boolean(getServerEnv().DATA_ENCRYPTION_KEY);
}
