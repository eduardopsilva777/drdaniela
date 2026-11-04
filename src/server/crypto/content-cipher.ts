import { decryptWithKeyring, encryptField, type Keyring } from "./field-encryption";

/**
 * Cifragem de conteúdos livres que podem conter dados sensíveis — textos das
 * mensagens do WhatsApp e perguntas guardadas para curadoria. Usa a mesma
 * chave das observações (DATA_ENCRYPTION_KEY, AES-256-GCM, rotação suportada).
 *
 * Sem chave configurada (desenvolvimento), o texto é gravado como está; a
 * leitura aceita os dois formatos, então ativar a chave depois não quebra nada.
 * Em produção a ausência da chave gera aviso na inicialização.
 *
 * Sem `server-only`: também usado pelos scripts de manutenção (rotação de chave).
 */

/** "v1:<iv 12 bytes>:<tag 16 bytes>:<conteúdo>" em base64url. */
const SEALED_PATTERN = /^v1:[A-Za-z0-9_-]{16}:[A-Za-z0-9_-]{22}:[A-Za-z0-9_-]*$/;

export const UNREADABLE_TEXT = "[conteúdo cifrado indisponível — confira a chave DATA_ENCRYPTION_KEY]";

/** Contexto autenticado: o texto cifrado só é aceito na conversa de origem. */
export function messageContext(conversationId: string): string {
  return `whatsapp_message:${conversationId}`;
}

export const KNOWLEDGE_GAP_CONTEXT = "knowledge_gap";

export function isSealed(value: string): boolean {
  return SEALED_PATTERN.test(value);
}

export function sealText(text: string, context: string, keyring: Keyring | null): string {
  return keyring ? encryptField(text, keyring.current, context) : text;
}

export function openText(stored: string | null, context: string, keyring: Keyring | null): string | null {
  if (stored === null) return null;
  if (!isSealed(stored)) return stored;
  if (!keyring) return UNREADABLE_TEXT;
  try {
    return decryptWithKeyring(stored, keyring, context).plaintext;
  } catch {
    return UNREADABLE_TEXT;
  }
}

/**
 * Mensagens de uma conversa com o texto decifrado para exibição ou exportação
 * (`null` continua indicando conteúdo apagado). Toda leitura de `body` fora do
 * processamento interno deve passar por aqui — o valor gravado é cifrado.
 */
export function openMessageBodies<T extends { body: string | null }>(
  conversationId: string,
  messages: readonly T[],
  keyring: Keyring | null,
): T[] {
  const context = messageContext(conversationId);
  return messages.map((message) => ({ ...message, body: openText(message.body, context, keyring) }));
}
