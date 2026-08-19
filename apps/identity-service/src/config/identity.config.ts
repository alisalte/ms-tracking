import { baseConfigSchema } from '@fleetvision/config';
import { z } from 'zod';

/**
 * identity-service config schema.
 *
 * Extends the base schema (port, host, logLevel, environment) with the
 * infrastructure endpoints identity talks to (Postgres, Redis, Kafka) and the
 * Sprint 2 auth parameters (JWT signing, argon2 password hashing, login
 * lockout policy).
 *
 * Env var names are the UPPERCASE keys zod reads off process.env — the config
 * module supplies serviceName; everything else comes from the environment
 * (infra/docker/.env for local dev).
 */
export const identityConfigSchema = baseConfigSchema.merge(
  z.object({
    /** Postgres connection URL (e.g. `postgres://fleetvision:pw@localhost:5432/fleetvision`). */
    DBURL: z.string().min(1),
    /** Privileged Postgres URL for migrations/platform ops (BYPASSRLS role). */
    DBURL_PLATFORM: z.string().min(1),
    /** Redis connection URL (e.g. `redis://localhost:6379/0`). */
    REDISURL: z.string().min(1),

    // --- JWT / OAuth2 identity (docs/specs/16_Public-API-Platform.md §7) ---
    /** Token issuer claim (`iss`). */
    JWT_ISSUER: z.string().min(1).default('fleetvision'),
    /**
     * Expected audience claim (`aud`). Sprint B standardizes the audience
     * platform-wide (`fleetvision`) so one token verifies in every service.
     */
    JWT_AUDIENCE: z.string().min(1).default('fleetvision'),
    /**
     * HMAC signing secret for the MVP (HS256). Must be >= 32 chars. Migrates to
     * RS256/JWKS (Vault Transit) in a later security hardening sprint.
     */
    JWT_SECRET: z.string().min(32),
    /** Access-token time-to-live, human string parsed by `ms`-style seconds. */
    JWT_ACCESS_TTL: z.string().min(1).default('900s'),
    /** Refresh-token time-to-live (rotated on every use). */
    JWT_REFRESH_TTL: z.string().min(1).default('604800s'),

    // --- Password hashing (docs/specs/Authentication.md §6.9: Argon2id m=64MiB, t=3, p=1) ---
    /** Argon2id memory cost in KiB (65536 = 64 MiB). */
    ARGON2_MEMORY_KIB: z.coerce.number().int().min(8).default(65536),
    /** Argon2id time cost (iterations). */
    ARGON2_TIME: z.coerce.number().int().min(1).default(3),
    /** Argon2id parallelism (lanes). */
    ARGON2_PARALLELISM: z.coerce.number().int().min(1).default(1),

    // --- Password policy (Identity-Access-Management.md §8) ---
    PASSWORD_MIN_LENGTH: z.coerce.number().int().min(8).default(12),
    /** Number of prior hashes a new password must not match. */
    PASSWORD_HISTORY_COUNT: z.coerce.number().int().min(0).default(5),

    // --- Brute-force / lockout (Authentication.md §9.5 AUTH-BR-03) ---
    LOGIN_MAX_ATTEMPTS: z.coerce.number().int().min(1).default(5),
    LOGIN_LOCKOUT_SECONDS: z.coerce.number().int().min(1).default(900),

    // --- Kafka (event outbox relay for audit) ---
    /** Comma-separated broker list, e.g. `localhost:9092`. */
    KAFKA_BROKERS: z.string().min(1).default('localhost:9092'),
    /** Topic audit entries are published to via the outbox relay. */
    KAFKA_AUDIT_TOPIC: z.string().min(1).default('fleetvision.audit.audit-entries.events'),
    /** Client id used by the Kafka producer. */
    KAFKA_CLIENT_ID: z.string().min(1).default('identity-service'),

    // --- Bootstrap ---
    /**
     * Bootstrap admin credentials used by the seed script (provision the first
     * tenant + tenant-admin user). Empty string disables seeding.
     */
    SEED_TENANT_NAME: z.string().default('FleetVision'),
    SEED_ADMIN_EMAIL: z.string().default('admin@fleetvision.local'),
    SEED_ADMIN_PASSWORD: z.string().min(12).default('ChangeMe!StrongPass123'),
  }),
);

export type IdentityConfig = z.infer<typeof identityConfigSchema>;
