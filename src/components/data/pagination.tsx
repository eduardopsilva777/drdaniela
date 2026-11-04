import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Paginação por links (funciona sem JavaScript e preserva os filtros da URL). */
export function Pagination({
  page,
  pageSize,
  total,
  basePath,
  params,
}: {
  page: number;
  pageSize: number;
  total: number;
  basePath: string;
  params: Record<string, string | undefined>;
}) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;

  const hrefFor = (target: number) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value && key !== "pagina") search.set(key, value);
    }
    if (target > 1) search.set("pagina", String(target));
    const query = search.toString();
    return query ? `${basePath}?${query}` : basePath;
  };

  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <nav
      aria-label="Paginação"
      className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 text-sm sm:px-6"
    >
      <p className="text-muted-foreground tabular-nums">
        {from}–{to} de {total}
      </p>
      <div className="flex items-center gap-1.5">
        {page > 1 ? (
          <Link href={hrefFor(page - 1)} className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>
            <ChevronLeft aria-hidden />
            Anterior
          </Link>
        ) : null}
        <span className="px-2 text-muted-foreground tabular-nums">
          Página {Math.min(page, pageCount)} de {pageCount}
        </span>
        {page < pageCount ? (
          <Link href={hrefFor(page + 1)} className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>
            Próxima
            <ChevronRight aria-hidden />
          </Link>
        ) : null}
      </div>
    </nav>
  );
}
