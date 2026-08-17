import { authConfigSchema } from '@fleetvision/auth';
import { baseConfigSchema } from '@fleetvision/config';
import { z } from 'zod';

/**
 * device-gateway-service config schema (06 §1.5, §16).
 *
 * Extends the base schema with the gateway-specific parameters: admin HTTP port,
 * listener list, pool/timeout/heartbeat knobs, the plugin directory, and the
 * Kafka producer settings. Env var names are the UPPERCASE keys zod reads off
 * process.env (infra/docker/.env for local dev).
 *
 * Sprint B merges `authConfigSchema` so the ADMIN/control HTTP API verifies the
 * same JWT as identity-service. The device TCP/UDP protocol listeners are NOT
 * HTTP routes and remain authenticated by their device-protocol auth (IMEI/serial),
 * untouched by the HTTP auth guard.
 *
 * Kafka/Redis are non-fatal at boot (06 §15.4): the service starts even when
 * they are down and reconnects lazily, mirroring the identity-service outbox.
 */
export const deviceGatewayConfigSchema = baseConfigSchema.merge(authConfigSchema).merge(
  z.object({
    /** Admin HTTP port (health + admin API). Protocol listeners open their own ports. */
    GATEWAY_ADMIN_PORT: z.coerce.number().int().min(1).max(65535).default(8081),
    /** Bind address for protocol + admin listeners. */
    GATEWAY_HOST: z.string().min(1).default('0.0.0.0'),

    /**
     * Comma-separated listener list: <adapterId>:<transport>:<port>.
     * e.g. "gt06:tcp:5016,stub:tcp:5099,gt06:udp:5016". Empty = no listeners.
     */
    GATEWAY_LISTENERS: z.string().default(''),

    /** Per-pod connection cap (06 §5.1 — default 100K TCP sockets). */
    GATEWAY_MAX_CONNECTIONS: z.coerce.number().int().min(1).default(100_000),
    /** TCP idle timeout (seconds) — socket.setTimeout (06 §12.2; default 180s). */
    GATEWAY_TCP_IDLE_TIMEOUT_SECONDS: z.coerce.number().int().min(1).default(180),
    /** TCP global session Redis TTL (seconds) — 06 §16.1 default 60s (Sprint D). */
    GATEWAY_TCP_SESSION_TTL_SECONDS: z.coerce.number().int().min(5).default(60),
    /** Auth grace (seconds) — NEW/IDENTIFY older than this is swept (06 §12.4). */
    GATEWAY_AUTH_GRACE_SECONDS: z.coerce.number().int().min(1).default(15),
    /** Liveness sweep interval (seconds) — dup-detect + auth-grace + UDP TTL (Sprint D §7). */
    GATEWAY_SWEEP_INTERVAL_SECONDS: z.coerce.number().int().min(5).default(20),
    /** Auth-resolver L1 cache TTL (seconds) — default 30s (06 §7.2). */
    GATEWAY_AUTH_L1_TTL_SECONDS: z.coerce.number().int().min(1).default(30),
    /** Auth-resolver L1 LRU size — hottest devices kept in-process (06 §7.2). */
    GATEWAY_AUTH_L1_MAX_ENTRIES: z.coerce.number().int().min(1).default(10_000),
    /** Auth-resolver L2 Redis TTL (seconds) — default 5m (06 §7.2). */
    GATEWAY_AUTH_L2_TTL_SECONDS: z.coerce.number().int().min(1).default(300),
    /** Data-liveness factor — stale after factor * reporting interval (06 §12.1). */
    GATEWAY_DATA_STALE_FACTOR: z.coerce.number().int().min(1).default(3),
    /** Default reporting interval (seconds) when a device hasn't declared one. */
    GATEWAY_DEFAULT_REPORTING_INTERVAL_SECONDS: z.coerce.number().int().min(1).default(60),
    /** UDP pseudo-session TTL (seconds) — 2x report interval (06 §4.4). */
    GATEWAY_UDP_SESSION_TTL_SECONDS: z.coerce.number().int().min(1).default(120),

    /** Directory scanned for out-of-tree adapter plugins (06 §9.3). Empty = disabled. */
    GATEWAY_PLUGIN_DIR: z.string().default(''),

    // --- Redis (session store; non-fatal at boot) ---
    REDISURL: z.string().min(1).default('redis://localhost:6379/1'),

    // --- Postgres (listener config table; non-fatal at boot) ---
    DBURL: z
      .string()
      .min(1)
      .default('postgres://fleetvision:fleetvision@localhost:5432/fleetvision'),

    // --- JWT verification (same HS256 token issued by identity-service) ---
    JWT_SECRET: z.string().min(32),
    JWT_ISSUER: z.string().min(1).default('fleetvision'),
    JWT_AUDIENCE: z.string().min(1).default('fleetvision-identity'),

    // --- Kafka producer (06 §13.2; non-fatal at boot) ---
    GATEWAY_KAFKA_BROKERS: z.string().min(1).default('localhost:9092'),
    GATEWAY_KAFKA_CLIENT_ID: z.string().min(1).default('device-gateway-service'),
    GATEWAY_KAFKA_POSITION_TOPIC: z.string().min(1).default('fleetvision.telemetry.position.raw'),
    GATEWAY_KAFKA_ALARM_TOPIC: z.string().min(1).default('fleetvision.telemetry.alarm.raw'),
    GATEWAY_KAFKA_DEVICE_TOPIC: z.string().min(1).default('fleetvision.telemetry.device.raw'),
    GATEWAY_KAFKA_SESSION_TOPIC: z
      .string()
      .min(1)
      .default('fleetvision.telemetry.session.lifecycle'),
    /** Downstream command requests consumed from this topic (06 §11.3 SendDeviceCommand). */
    GATEWAY_KAFKA_COMMAND_REQUEST_TOPIC: z
      .string()
      .min(1)
      .default('fleetvision.telemetry.command.request'),
    /** Kafka producer bounded retry attempts (Sprint D §13). */
    GATEWAY_KAFKA_RETRIES: z.coerce.number().int().min(0).default(8),
    /** Kafka producer initial retry backoff (ms) — Sprint D §13. */
    GATEWAY_KAFKA_RETRY_INITIAL_MS: z.coerce.number().int().min(10).default(300),
    /** Kafka producer retry backoff ceiling (ms) — Sprint D §13. */
    GATEWAY_KAFKA_RETRY_MAX_MS: z.coerce.number().int().min(100).default(30_000),
    /** Kafka producer linger/batch (ms) — 06 §13.2. */
    GATEWAY_KAFKA_LINGER_MS: z.coerce.number().int().min(0).default(20),
    /** Expose GET /metrics (Prometheus) — Sprint D §33. */
    GATEWAY_METRICS_ENABLED: z.coerce.boolean().default(true),

    // --- Fleet device registry (Sprint C) ---
    // The gateway resolves IMEI → device identity from fleet-management-service over
    // HTTP (L3, cache-miss only). baseUrl = fleet-management's address; apiKey is the
    // service API key carrying `device.registry.resolve`. Empty key → fail-closed.
    FLEET_REGISTRY_URL: z.string().min(1).default('http://localhost:3006'),
    FLEET_REGISTRY_API_KEY: z.string().default(''),
    /** Fleet registry resolve HTTP timeout (ms) — Sprint D §12. */
    FLEET_REGISTRY_TIMEOUT_MS: z.coerce.number().int().min(100).default(3_000),
    /** Fleet registry bounded retries on TRANSIENT failures (§12). */
    FLEET_REGISTRY_MAX_RETRIES: z.coerce.number().int().min(0).default(2),
    /** Fleet registry retry backoff base (ms). */
    FLEET_REGISTRY_RETRY_BACKOFF_MS: z.coerce.number().int().min(10).default(250),
  }),
);

export type DeviceGatewayConfig = z.infer<typeof deviceGatewayConfigSchema>;

/** Parse the configured listeners into structured form. */
export interface ParsedListener {
  readonly adapterId: string;
  readonly transport: 'tcp' | 'udp';
  readonly port: number;
}

export function parseListeners(raw: string): readonly ParsedListener[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const parts = entry.split(':');
      const adapterId = parts[0];
      const transport = parts[1];
      const port = Number(parts[2]);
      if (
        !adapterId ||
        (transport !== 'tcp' && transport !== 'udp') ||
        !Number.isInteger(port) ||
        port < 1 ||
        port > 65535
      ) {
        throw new Error(`Invalid listener '${entry}' — expected <adapterId>:<tcp|udp>:<port>.`);
      }
      return { adapterId, transport, port } as ParsedListener;
    });
}
