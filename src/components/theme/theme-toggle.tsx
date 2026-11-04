"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { applyThemePreference, readThemePreference, type ThemePreference } from "./theme";

/**
 * Seletor de tema do cabeçalho. O ícone acompanha o tema em uso pela própria
 * classe `dark` (sem estado no servidor nem divergência de hidratação); a
 * preferência só é lida no navegador, ao abrir o menu.
 */
export function ThemeToggle() {
  const [preference, setPreference] = useState<ThemePreference>("system");

  // No modo automático, acompanha a troca de tema do sistema operacional.
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (readThemePreference() === "system") applyThemePreference("system");
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  return (
    <DropdownMenu onOpenChange={(open) => open && setPreference(readThemePreference())}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon" aria-label="Tema da interface" className="text-muted-foreground hover:text-foreground">
          <Sun aria-hidden className="dark:hidden" />
          <Moon aria-hidden className="hidden dark:block" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">Tema</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={preference}
          onValueChange={(value) => {
            const next = value as ThemePreference;
            setPreference(next);
            applyThemePreference(next);
          }}
        >
          <DropdownMenuRadioItem value="light">
            <Sun aria-hidden />
            Claro
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">
            <Moon aria-hidden />
            Escuro
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system">
            <Monitor aria-hidden />
            Automático
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
