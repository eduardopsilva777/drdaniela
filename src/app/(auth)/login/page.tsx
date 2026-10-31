import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { Monogram } from "@/components/brand/monogram";
import { Skeleton } from "@/components/ui/skeleton";
import { sanitizeNextPath } from "@/lib/auth/redirect";
import { getCurrentSession } from "@/server/auth/dal";

import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Entrar" };

export default function LoginPage(props: PageProps<"/login">) {
  return (
    <main className="grid min-h-dvh lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
      <BrandPanel />

      <section className="flex flex-col justify-center px-5 py-12 sm:px-10 lg:px-16">
        <div className="mx-auto w-full max-w-sm">
          <div className="mb-10 flex items-center gap-3 lg:hidden">
            <Monogram className="h-5" />
            <span className="font-display text-2xl leading-none text-foreground">
              Daniela Zilioli
            </span>
          </div>
          <Suspense fallback={<LoginFormFallback />}>
            <LoginGate searchParams={props.searchParams} />
          </Suspense>
        </div>
      </section>
    </main>
  );
}

/**
 * Se já houver sessão válida (verificada no banco), vai direto ao destino.
 * Um cookie expirado não causa redirecionamento: o formulário é exibido.
 */
async function LoginGate({ searchParams }: { searchParams: PageProps<"/login">["searchParams"] }) {
  const [session, params] = await Promise.all([getCurrentSession(), searchParams]);
  const next = sanitizeNextPath(typeof params.next === "string" ? params.next : undefined);
  if (session) redirect(next);
  return <LoginForm next={next} />;
}

function BrandPanel() {
  return (
    <section
      aria-label="Dra. Daniela Zilioli"
      className="relative hidden flex-col justify-between overflow-hidden border-r border-border bg-onyx px-14 py-12 lg:flex xl:px-20"
    >
      <Monogram className="h-6 self-start" />

      <div className="max-w-xl">
        <p className="text-sm text-muted-foreground">Dra.</p>
        <p className="mt-2 font-display text-[clamp(4rem,7vw,7rem)] leading-[0.92] text-foreground motion-safe:animate-in motion-safe:fade-in motion-safe:duration-1000">
          Daniela
          <br />
          Zilioli
        </p>
        <p className="mt-8 max-w-[38ch] text-base leading-relaxed text-muted-foreground">
          Leads, pacientes, agenda e retornos da clínica, em um só lugar.
        </p>
      </div>

      <p className="max-w-[48ch] text-xs leading-relaxed text-muted-foreground/80">
        Acesso restrito à equipe da clínica. As entradas e as ações realizadas no sistema são
        registradas.
      </p>
    </section>
  );
}

function LoginFormFallback() {
  return (
    <div className="space-y-7" aria-hidden>
      <div className="space-y-2">
        <Skeleton className="h-7 w-24" />
        <Skeleton className="h-4 w-64 max-w-full" />
      </div>
      <div className="space-y-5">
        <Skeleton className="h-11 w-full rounded-lg" />
        <Skeleton className="h-11 w-full rounded-lg" />
      </div>
      <Skeleton className="h-11 w-full rounded-lg" />
    </div>
  );
}
