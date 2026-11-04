import { parsePhoneNumberFromString, type CountryCode } from "libphonenumber-js/min";

/**
 * Telefones são guardados sempre em E.164 (ex.: +5511987654321), o que permite
 * deduplicar contatos e falar com a API do WhatsApp. Números sem DDI são
 * interpretados como brasileiros.
 */

export function normalizePhone(input: string, defaultCountry: CountryCode = "BR"): string | null {
  const trimmed = input.trim();
  if (!trimmed || trimmed.length > 32) return null;
  const parsed = parsePhoneNumberFromString(trimmed, defaultCountry);
  if (!parsed || !parsed.isValid()) return null;
  return parsed.number;
}

/** Exibição: formato nacional para números brasileiros, internacional para os demais. */
export function formatPhone(e164: string): string {
  const parsed = parsePhoneNumberFromString(e164);
  if (!parsed) return e164;
  return parsed.country === "BR" ? parsed.formatNational() : parsed.formatInternational();
}

/** Apenas os dígitos digitados — usado para buscar telefones por trecho. */
export function phoneDigits(input: string): string {
  return input.replace(/\D/g, "");
}

/** Link para conversar no WhatsApp a partir do número em E.164. */
export function whatsappLink(e164: string): string {
  return `https://wa.me/${phoneDigits(e164)}`;
}
