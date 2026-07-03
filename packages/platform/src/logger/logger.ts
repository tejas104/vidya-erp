import { pino, type Logger } from "pino";

export interface LoggerOptions {
  readonly level: string;
  readonly serviceName: string;
  readonly serviceVersion?: string;
}

/**
 * Structured JSON logger. Output is one JSON object per line, suitable for
 * shipping to a log aggregator. For human-readable local output, pipe through
 * pino-pretty: `pnpm dev | pnpm exec pino-pretty`.
 */
export function createLogger(options: LoggerOptions): Logger {
  return pino({
    level: options.level,
    base: {
      service: options.serviceName,
      version: options.serviceVersion,
      pid: process.pid,
    },
    redact: {
      paths: [
        "authorization",
        "cookie",
        "password",
        "secret",
        "*.authorization",
        "*.cookie",
        "*.password",
        "*.secret",
      ],
      censor: "[redacted]",
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}

export type { Logger };
