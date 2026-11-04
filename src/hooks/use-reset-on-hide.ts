"use client";

import { useEffectEvent, useLayoutEffect } from "react";

/**
 * Com Cache Components, páginas visitadas ficam ocultas (React `<Activity>`) em
 * vez de desmontadas. Diálogos e mensagens transitórias devem ser fechados quando
 * a página é ocultada, para não reaparecerem abertos ao voltar.
 */
export function useResetOnHide(reset: () => void) {
  const onHide = useEffectEvent(reset);
  useLayoutEffect(() => {
    return () => onHide();
  }, []);
}
