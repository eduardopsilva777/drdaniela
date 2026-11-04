import Link from "next/link";

import { ClinniLogo } from "@/components/brand/clinni-logo";
import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-start justify-center gap-7 bg-background px-6 py-16 sm:px-16">
      <ClinniLogo className="h-8" title="Clinni" />
      <div className="space-y-3">
        <h1 className="text-title-1 text-foreground sm:text-[2.25rem] sm:leading-[2.75rem]">Página não encontrada</h1>
        <p className="max-w-[52ch] text-[0.9375rem] leading-relaxed text-muted-foreground">
          O endereço pode estar incorreto ou a página foi removida.
        </p>
      </div>
      <Link href="/dashboard" className={buttonVariants({ size: "lg" })}>
        Ir para o dashboard
      </Link>
    </main>
  );
}
