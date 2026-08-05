/**
 * Base config schema shared by every service. Services extend this with their
 * own schema (Codebase Architecture §13) — every service at minimum needs a
 * listen port, log level, and the infrastructure endpoints it talks to.
 *
 * Config lives in the **environment** (Twelve-factor): zod keys therefore match
 * the conventional UPPERCASE env-var names so `safeParse(process.env)` reads the
 * right key (e.g. `PORT`, `LOG_LEVEL`). `serviceName` is injected by code in
 * `ConfigModule.forRoot({ serviceName })` rather than read from env, since each
 * service knows its own name statically. The schema is validated at boot; an
 * invalid config throws (crashes fast).
 */
import { z } from 'zod';

/** Log levels aligned with pino's level set. */
export const logLevelSchema = z
  .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal'])
  .default('info');

/** The shape every FleetVision service config shares. */
export const baseConfigSchema = z.object({
  /**
   * Logical service name — appears in logs, traces, and event `source`. Injected
   * by `ConfigModule.forRoot({ serviceName })` (each service knows its own name
   * statically), NOT read from an env var.
   */
  serviceName: z.string().min(1),
  /** HTTP listen port. */
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  /** Bind address. */
  HOST: z.string().default('0.0.0.0'),
  /** Structured log level. */
  LOG_LEVEL: logLevelSchema,
  /** Deployment environment (drives feature flags, retention, rate limits). */
  ENVIRONMENT: z.enum(['local', 'dev', 'staging', 'production']).default('local'),
});

export type BaseConfig = z.infer<typeof baseConfigSchema>;
