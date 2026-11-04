import "server-only";

import { getServerEnv } from "@/server/env";

import type { Keyring } from "./field-encryption";
import { getNoteKeyring } from "./note-key";

/**
 * Chaves usadas para cifrar mensagens do WhatsApp e perguntas de curadoria.
 * Nula quando DATA_ENCRYPTION_KEY não está configurada (desenvolvimento):
 * nesse caso os textos são gravados sem cifragem.
 */
export function getContentKeyring(): Keyring | null {
  return getServerEnv().DATA_ENCRYPTION_KEY ? getNoteKeyring() : null;
}
