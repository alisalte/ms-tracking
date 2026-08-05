/**
 * pino logger factory — builds the single structured logger per service.
 *
 * Output is JSON to stdout, enriched with the mandatory correlation fields
 * (01 §11.3) via AsyncLocalStorage. In local/development it pretty-prints for
 * readability; in production it streams raw JSON for Loki ingestion.
 */
import { type LoggerOptions, pino } from 'pino';
import { getCorrelation } from './correlation-context.js';

export interface LoggerFactoryOptions {
  serviceName: string;
  level: string;
  /** When true, pretty-print (dev/local). Default: true for local/dev. */
  pretty?: boolean;
  environment?: string;
}

/**
 * Build a pino logger. The base bindings include `service` so every line carries
 * the service identity (01 §11.3 `service` field). Per-request correlation fields
 * are merged in by the mixin on each log call.
 */
export function createLogger(opts: LoggerFactoryOptions) {
  const isLocal =
    opts.environment === undefined || opts.environment === 'local' || opts.environment === 'dev';
  const pretty = opts.pretty ?? isLocal;

  const transport: LoggerOptions['transport'] = pretty
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:HH:MM:ss.l',
          ignore: 'pid,hostname',
        },
      }
    : undefined;

  const logger = pino({
    name: opts.serviceName,
    level: opts.level,
    transport,
    // Merge correlation context into every log record (01 §11.3 fields).
    mixin: () => {
      const ctx = getCorrelation();
      return {
        ...(ctx.traceId ? { trace_id: ctx.traceId } : {}),
        ...(ctx.correlationId ? { correlation_id: ctx.correlationId } : {}),
        ...(ctx.tenantId ? { tenant_id: ctx.tenantId } : {}),
        ...(ctx.userId ? { user_id: ctx.userId } : {}),
      };
    },
    // Redact PII-bearing fields before serialization (defense-in-depth; the OTel
    // collector pipeline does the authoritative redaction per 01 §11.3).
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        '*.password',
        '*.secret',
        '*.token',
        '*.ssn',
        '*.licenseNumber',
      ],
      censor: '[REDACTED]',
    },
  });

  return logger;
}

export type PinoLogger = ReturnType<typeof createLogger>;
