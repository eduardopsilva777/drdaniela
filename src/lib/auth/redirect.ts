export const DEFAULT_AUTHENTICATED_PATH = "/dashboard";

/**
 * Valida o destino pós-login recebido via `?next=`, evitando redirecionamento
 * aberto (open redirect) para domínios externos.
 *
 * Aceita apenas caminhos internos absolutos, como `/leads?status=NEW`.
 */
export function sanitizeNextPath(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 512) {
    return DEFAULT_AUTHENTICATED_PATH;
  }

  // Precisa começar com uma única barra: bloqueia "//evil.com" e "/\evil.com",
  // que navegadores interpretam como URLs relativas ao protocolo.
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) {
    return DEFAULT_AUTHENTICATED_PATH;
  }

  // Caracteres de controle (ex.: quebras de linha) e barras invertidas não são aceitos.
  if (/[\u0000-\u001f\u007f\\]/.test(value)) {
    return DEFAULT_AUTHENTICATED_PATH;
  }

  let parsed: URL;
  try {
    parsed = new URL(value, "http://internal.invalid");
  } catch {
    return DEFAULT_AUTHENTICATED_PATH;
  }

  if (parsed.origin !== "http://internal.invalid") {
    return DEFAULT_AUTHENTICATED_PATH;
  }

  if (parsed.pathname === "/login" || parsed.pathname.startsWith("/api/")) {
    return DEFAULT_AUTHENTICATED_PATH;
  }

  return `${parsed.pathname}${parsed.search}`;
}
