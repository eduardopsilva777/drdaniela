const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/** Valores monetários são guardados em centavos (inteiros) para evitar erros de arredondamento. */
export function formatBRL(cents: number): string {
  return BRL.format(cents / 100);
}

/**
 * Converte o que a equipe digita ("R$ 1.250,00", "1250", "1250,5") em centavos.
 * Retorna `null` quando o texto não representa um valor válido.
 */
export function parseMoneyToCents(input: string): number | null {
  let text = input.replace(/R\$|\s/g, "").trim();
  if (!text) return null;
  if (text.includes(",")) {
    text = text.replace(/\./g, "").replace(",", ".");
  } else if (/^\d{1,3}(\.\d{3})+$/.test(text)) {
    text = text.replace(/\./g, ""); // "1.250" = mil duzentos e cinquenta
  }
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const cents = Math.round(Number(text) * 100);
  return Number.isSafeInteger(cents) && cents <= 100_000_000_00 ? cents : null;
}

/** Centavos → texto para preencher campos de formulário ("1250,00"). */
export function centsToInput(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "";
  return (cents / 100).toFixed(2).replace(".", ",");
}
