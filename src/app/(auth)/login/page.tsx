import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { ClinicMark, ClinniLogo } from "@/components/brand/clinni-logo";
import { Skeleton } from "@/components/ui/skeleton";
import { sanitizeNextPath } from "@/lib/auth/redirect";
import { getCurrentSession } from "@/server/auth/dal";
import { getPublicClinicName } from "@/server/queries/clinic";

import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Entrar" };

export default function LoginPage(props: PageProps<"/login">) {
  return (
    <main className="grid min-h-dvh bg-background lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <BrandPanel />

      <section className="flex flex-col justify-center px-5 py-12 sm:px-10 lg:px-16">
        <div className="mx-auto w-full max-w-sm">
          <ClinniLogo className="mb-12 h-8 lg:hidden" title="Clinni" />
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
  const [session, params, clinicName] = await Promise.all([getCurrentSession(), searchParams, getPublicClinicName()]);
  const next = sanitizeNextPath(typeof params.next === "string" ? params.next : undefined);
  if (session) redirect(next);
  return (
    <>
      {clinicName ? (
        <p className="mb-5 inline-flex max-w-full items-center gap-2 rounded-full bg-muted py-1 pr-3.5 pl-1 text-[0.8125rem] font-medium text-foreground">
          <ClinicMark name={clinicName} className="size-6 rounded-full text-[0.625rem]" />
          <span className="truncate">{clinicName}</span>
        </p>
      ) : null}
      <LoginForm next={next} />
    </>
  );
}

/** Arco do símbolo (traçado oficial) como elemento gráfico de fundo. */
function BrandArc({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 512 512" aria-hidden className={className}>
      <path
        className="fill-brand-on-surface/[0.07]"
        d="M287.199 1.908A256 256 0 1 0 511.961 251.532L392.835 253.612A136.855 136.855 0 1 1 272.678 120.165Z"
      />
    </svg>
  );
}

function BrandPanel() {
  return (
    <section
      aria-label="Clinni"
      className="relative hidden flex-col justify-between overflow-hidden bg-brand-surface px-14 py-12 text-brand-on-surface lg:flex xl:px-[4.5rem]"
    >
      <BrandArc className="pointer-events-none absolute -right-40 -bottom-56 size-[38rem] xl:size-[44rem]" />

      <ClinniLogo tone="inverse" className="relative h-9 self-start" title="Clinni" />

      <div className="relative max-w-xl">
        <span aria-hidden className="mb-7 block size-3.5 rounded-full bg-brand-dot-light" />
        <p className="text-[clamp(2.75rem,4.4vw,3.5rem)] leading-[1.06] font-semibold tracking-[-0.03em] motion-safe:animate-in motion-safe:fade-in motion-safe:duration-700">
          Do primeiro contato ao relacionamento contínuo.
        </p>
        <p className="mt-6 max-w-[42ch] text-lg leading-relaxed text-brand-on-surface/85">
          Leads, pacientes, agenda e retornos da clínica, em um só lugar.
        </p>
      </div>

      <p className="relative max-w-[52ch] text-xs leading-relaxed text-brand-on-surface-muted">
        Acesso restrito à equipe da clínica. As entradas e as ações realizadas no sistema são registradas.
      </p>
    </section>
  );
}

function LoginFormFallback() {
  return (
    <div className="space-y-7" aria-hidden>
      <div className="space-y-2">
        <Skeleton className="h-8 w-28" />
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
