"use client";

import { RotateCcw } from "lucide-react";

import { PageContainer, Panel } from "@/components/layout/page";
import { Button } from "@/components/ui/button";

/**
 * Erro inesperado em uma página autenticada. Não exibe detalhes técnicos
 * (podem conter dados sensíveis); o código de referência ajuda o suporte a
 * localizar o registro no log do servidor.
 */
export default function AppError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <PageContainer>
      <Panel role="alert" className="max-w-2xl p-6 sm:p-8">
        <h1 className="text-title-2 text-foreground">Não foi possível carregar esta página</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          Algo falhou ao buscar as informações. Tente novamente; se o problema continuar, informe o
          código abaixo à administração da clínica.
        </p>
        {error.digest ? (
          <p className="mt-4 text-xs text-muted-foreground">
            Código de referência: <span className="text-foreground tabular-nums">{error.digest}</span>
          </p>
        ) : null}
        <Button className="mt-6" onClick={() => retry()}>
          <RotateCcw aria-hidden />
          Tentar novamente
        </Button>
      </Panel>
    </PageContainer>
  );
}
