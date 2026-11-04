/**
 * Tema da interface (claro, escuro ou automático pelo sistema), guardado só no
 * navegador — preferência visual, sem dado pessoal e sem ida ao servidor (o
 * layout continua pré-renderizado). O script inline aplica a classe `dark`
 * antes da primeira pintura (sem "piscar"); o seletor do cabeçalho troca e salva.
 */

export type ThemePreference = "light" | "dark" | "system";

export const THEME_STORAGE_KEY = "clinni-theme";

/** Executado no <head>, antes da pintura. Mantenha sem dependências. */
export const THEME_INIT_SCRIPT = `(function(){try{var p=localStorage.getItem("${THEME_STORAGE_KEY}");var d=p==="dark"||(p!=="light"&&window.matchMedia("(prefers-color-scheme: dark)").matches);var r=document.documentElement;r.classList.toggle("dark",d);r.style.colorScheme=d?"dark":"light"}catch(e){}})()`;

export function readThemePreference(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    return "system";
  }
}

export function applyThemePreference(preference: ThemePreference) {
  const dark =
    preference === "dark" || (preference === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  const root = document.documentElement;
  root.classList.toggle("dark", dark);
  root.style.colorScheme = dark ? "dark" : "light";
  try {
    if (preference === "system") window.localStorage.removeItem(THEME_STORAGE_KEY);
    else window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Armazenamento indisponível (modo privado): o tema vale só nesta página.
  }
}
