import Link from "next/link";

import { Monogram } from "@/components/brand/monogram";
import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-start justify-center gap-6 px-6 py-16 sm:px-16">
      <Monogram className="h-6 self-start" />
      <div className="space-y-3">
        <h1 className="font-display text-4xl text-foreground sm:text-5xl">Página não encontrada</h1>
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
