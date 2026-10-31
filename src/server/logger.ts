import { redact, serializeError } from "./logging/redact";

/**
 * Logger estruturado com redação automática de dados sensíveis.
 * Produção: uma linha JSON por evento (pronta para agregadores de log).
 * Desenvolvimento: formato legível.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export type LogContext = Record<string, unknown>;

export interface Logger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
  child(bindings: LogContext): Logger;
}

export interface LoggerOptions {
  level?: LogLevel;
  format?: "json" | "pretty";
  bindings?: LogContext;
  includeStack?: boolean;
  write?: (level: LogLevel, line: string) => void;
}

function defaultWrite(level: LogLevel, line: string) {
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

function prepareContext(context: LogContext | undefined, includeStack: boolean): LogContext {
  if (!context) return {};
  const prepared: LogContext = {};
  for (const [key, value] of Object.entries(context)) {
    prepared[key] = value instanceof Error ? serializeError(value, includeStack) : value;
  }
  return redact(prepared) as LogContext;
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const level = options.level ?? "info";
  const format = options.format ?? "json";
  const write = options.write ?? defaultWrite;
  const includeStack = options.includeStack ?? false;
  const bindings = options.bindings ?? {};

  function log(entryLevel: LogLevel, message: string, context?: LogContext) {
    if (LEVEL_ORDER[entryLevel] < LEVEL_ORDER[level]) return;
    const payload = {
      ...prepareContext(bindings, includeStack),
      ...prepareContext(context, includeStack),
    };
    const time = new Date().toISOString();

    if (format === "json") {
      write(entryLevel, JSON.stringify({ time, level: entryLevel, msg: message, ...payload }));
      return;
    }
    const details = Object.keys(payload).length > 0 ? ` ${JSON.stringify(payload)}` : "";
    write(entryLevel, `${time} ${entryLevel.toUpperCase().padEnd(5)} ${message}${details}`);
  }

  return {
    debug: (message, context) => log("debug", message, context),
    info: (message, context) => log("info", message, context),
    warn: (message, context) => log("warn", message, context),
    error: (message, context) => log("error", message, context),
    child: (childBindings) =>
      createLogger({ ...options, bindings: { ...bindings, ...childBindings } }),
  };
}

function resolveLevel(value: string | undefined): LogLevel {
  return value === "debug" || value === "info" || value === "warn" || value === "error"
    ? value
    : "info";
}

const isProduction = process.env.NODE_ENV === "production";

export const logger = createLogger({
  level: resolveLevel(process.env.LOG_LEVEL),
  format: isProduction ? "json" : "pretty",
  includeStack: !isProduction,
});
