import { NextResponse, type NextRequest } from "next/server";

import { SESSION_COOKIE_NAME } from "@/lib/auth/session-cookie";

/**
 * Checagem OTIMISTA de autenticação: apenas verifica a presença do cookie de
 * sessão para redirecionar visitantes sem login antes de renderizar a página.
 *
 * Não é a barreira de segurança — a sessão é validada no banco pela DAL
 * (`src/server/auth/dal.ts`) em cada página, Server Action e Route Handler.
 * Por isso também não redireciona quem está em /login com um cookie qualquer
 * (o cookie pode estar expirado; quem decide é a própria página de login).
 */

const PUBLIC_PATHS = new Set(["/login"]);
const PUBLIC_PREFIXES = ["/api/health", "/api/webhooks/"];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.has(pathname) || PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (isPublicPath(pathname) || request.cookies.has(SESSION_COOKIE_NAME)) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.search = "";
  if (pathname !== "/") {
    loginUrl.searchParams.set("next", `${pathname}${search}`);
  }
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    // Tudo, exceto arquivos estáticos e metadados públicos.
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|apple-icon.png|robots.txt).*)",
  ],
};
