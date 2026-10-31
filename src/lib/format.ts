/**
 * Formatação de datas para a interface, sempre no fuso horário da clínica
 * (as datas são gravadas em UTC no banco).
 */

export const DEFAULT_TIME_ZONE = "America/Sao_Paulo";

export function formatLongDate(date: Date, timeZone = DEFAULT_TIME_ZONE): string {
  const formatted = new Intl.DateTimeFormat("pt-BR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone,
  }).format(date);
  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

export function formatDateTime(date: Date, timeZone = DEFAULT_TIME_ZONE): string {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  }).format(date);
}

/** Ex.: "31/10, 15:42" — para listas compactas. */
export function formatShortDateTime(date: Date, timeZone = DEFAULT_TIME_ZONE): string {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  }).format(date);
}

/** Ex.: 120 → "2 horas"; 45 → "45 minutos". */
export function formatDurationMinutes(minutes: number): string {
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return `${hours} ${hours === 1 ? "hora" : "horas"}`;
  }
  return `${minutes} ${minutes === 1 ? "minuto" : "minutos"}`;
}

export function formatTime(date: Date, timeZone = DEFAULT_TIME_ZONE): string {
  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  }).format(date);
}

/** Saudação conforme o horário local da clínica. */
export function greetingFor(date: Date, timeZone = DEFAULT_TIME_ZONE): string {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone }).format(date),
  );
  if (hour >= 5 && hour < 12) return "Bom dia";
  if (hour >= 12 && hour < 18) return "Boa tarde";
  return "Boa noite";
}

export function firstName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  const honorifics = new Set(["dra.", "dr.", "dra", "dr", "sra.", "sr."]);
  const name = parts.find((part) => !honorifics.has(part.toLowerCase()));
  return name ?? parts[0] ?? fullName;
}

export function initials(fullName: string): string {
  const parts = fullName
    .trim()
    .split(/\s+/)
    .filter((part) => !/^(dra?\.?|sra?\.?|de|da|do|das|dos|e)$/i.test(part));
  const letters = parts.length > 1 ? [parts[0]![0], parts.at(-1)![0]] : [parts[0]?.[0]];
  return letters.filter(Boolean).join("").toUpperCase();
}
