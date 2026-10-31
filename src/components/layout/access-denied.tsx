import { ShieldAlert } from "lucide-react";

import { Panel } from "./page";

/** Exibido quando o perfil do usuário não permite acessar a página. */
export function AccessDenied({ resource }: { resource: string }) {
  return (
    <Panel role="alert" className="max-w-2xl p-6 sm:p-8">
      <div className="flex items-start gap-4">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brick/10 text-brick">
          <ShieldAlert aria-hidden className="size-5" />
        </span>
        <div className="space-y-1.5">
          <h2 className="text-lg font-medium text-foreground">Acesso restrito</h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Seu perfil não tem permissão para ver {resource}. Se precisar deste acesso, peça à
            administração da clínica para revisar seu perfil.
          </p>
        </div>
      </div>
    </Panel>
  );
}
