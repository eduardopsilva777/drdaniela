import "server-only";

import { isIP } from "node:net";

import { headers } from "next/headers";

/**
 * Extrai o IP do cliente do cabeçalho X-Forwarded-For.
 *
 * Usa a entrada mais à direita: é a adicionada pelo salto mais próximo do
 * servidor (o proxy reverso, quando existe; ou o próprio Next.js, que preenche
 * o cabeçalho com o IP do socket quando ele não vem na requisição).
 * Sem proxy reverso confiável o valor pode ser forjado — por isso o bloqueio
 * por IP só é ativado com TRUST_PROXY=true.
 */
export function extractClientIp(forwardedFor: string | null | undefined): string | null {
  if (!forwardedFor) return null;
  const candidate = forwardedFor
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .at(-1);
  return candidate && isIP(candidate) !== 0 ? candidate : null;
}

export interface RequestMeta {
  ipAddress: string | null;
  userAgent: string | null;
}

export async function getRequestMeta(): Promise<RequestMeta> {
  const headerList = await headers();
  const userAgent = headerList.get("user-agent");
  return {
    ipAddress: extractClientIp(headerList.get("x-forwarded-for")),
    userAgent: userAgent ? userAgent.slice(0, 255) : null,
  };
}
