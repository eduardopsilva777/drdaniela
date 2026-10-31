/**
 * Nome do cookie de sessão. Fica isolado (sem dependências de servidor) porque
 * também é lido pelo `proxy.ts`.
 *
 * Em produção usa o prefixo `__Host-`, que obriga o navegador a aceitar o cookie
 * somente com `Secure`, `Path=/` e sem `Domain` — impede que subdomínios o sobrescrevam.
 */
export const SESSION_COOKIE_NAME =
  process.env.NODE_ENV === "production" ? "__Host-dz_session" : "dz_session";
