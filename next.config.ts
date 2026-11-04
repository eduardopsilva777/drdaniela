import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";
const servedOverHttps = process.env.APP_URL?.startsWith("https://") ?? false;

/**
 * Content Security Policy sem nonce: o prerender parcial (Cache Components)
 * é incompatível com CSP baseada em nonce, por isso scripts inline do próprio
 * Next.js precisam de 'unsafe-inline'. As demais diretivas continuam restritivas
 * (sem origens externas, sem plugins, sem embutir o app em iframes).
 */
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  `connect-src 'self'${isDev ? " ws: wss:" : ""}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ...(servedOverHttps ? ["upgrade-insecure-requests"] : []),
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
  },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  // Sistema interno com dados de saúde: nunca deve ser indexado.
  { key: "X-Robots-Tag", value: "noindex, nofollow" },
  ...(servedOverHttps
    ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]
    : []),
];

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  poweredByHeader: false,
  logging: {
    // Em desenvolvimento, o Next.js imprime os argumentos de cada Server Action
    // no terminal (mensagens, buscas por nome, motivos). Desligado: dados de saúde.
    serverFunctions: false,
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  async redirects() {
    return [{ source: "/", destination: "/dashboard", permanent: false }];
  },
};

export default nextConfig;
