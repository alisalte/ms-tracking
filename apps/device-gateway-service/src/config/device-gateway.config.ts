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
 * Kafka/Redis are non-fatal at boot (06 §15.4): the service starts even when
 * they are down and reconnects lazily, mirroring the identity-service outbox.
 */
export const deviceGatewayConfigSchema = baseConfigSchema.merge(
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
    /** Auth grace (seconds) — NEW/IDENTIFY older than this is closed (06 §12.4). */
    GATEWAY_AUTH_GRACE_SECONDS: z.coerce.number().int().min(1).default(10),
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
