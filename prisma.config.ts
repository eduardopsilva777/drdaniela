import { loadEnvConfig } from "@next/env";
import { defineConfig } from "prisma/config";

// Carrega os arquivos .env* na mesma ordem usada pelo Next.js,
// para que CLI do Prisma, seed e aplicação leiam a mesma configuração.
loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production", {
  info: () => {},
  error: console.error,
});

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // `process.env` (e não `env()`) para que `prisma generate` funcione em CI
    // sem DATABASE_URL; comandos que acessam o banco falham com mensagem clara.
    url: process.env.DATABASE_URL,
  },
});
