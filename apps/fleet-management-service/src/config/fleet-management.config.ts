import { authConfigSchema } from '@fleetvision/auth';
import { baseConfigSchema } from '@fleetvision/config';
import { z } from 'zod';

/**
 * fleet-management-service config schema.
 *
 * Extends the base schema (serviceName/PORT/HOST/LOG_LEVEL/ENVIRONMENT) and the
 * Sprint-B auth schema (JWT_SECRET/ISSUER/AUDIENCE) so this service verifies the
 * same JWT as identity-service and enforces `@RequirePermissions` via the shared
 * CompositeAuthGuard + PermissionsGuard.
 *
 * The default PORT is 3006 — the address the device-gateway points its
 * `FLEET_REGISTRY_URL` at (gateway → HTTP device resolution on cache miss).
 *
 * Kafka is consumed for ONE purpose: projecting the device-gateway's
 * `telemetry.session.lifecycle` events onto `fleet.devices` connection columns
 * (connected_at / last_seen_at / disconnected_at). It is non-fatal at boot
 * (mirrors the gps-engine consumer): the REST API serves even when Kafka is down.
 */
export const fleetManagementConfigSchema = baseConfigSchema.merge(authConfigSchema).merge(
  z.object({
    /** Override the base default (3000) — fleet-management listens on 3006. */
    PORT: z.coerce.number().int().min(1).max(65535).default(3006),

    // --- PostgreSQL (owns the `fleet` schema). ---
    /** Runtime client URL (app role, RLS-enforced). */
    DBURL: z
      .string()
      .min(1)
      .default('postgres://fleetvision:fleetvision@localhost:5432/fleetvision'),
    /**
     * Privileged platform-role URL for migrations (fleet schema DDL ownership).
     * Optional: when unset, migrations run on DBURL; on hardened stacks it
     * MUST point at fleetvision_platform (see persistence-knex module docs).
     */
    DBURL_PLATFORM: z.string().min(1).optional(),

    // --- Redis (cache + future use). ---
    REDISURL: z.string().min(1).default('redis://localhost:6379/2'),

    // --- Kafka consumer (session lifecycle → device connection state). ---
    FLEET_KAFKA_BROKERS: z.string().min(1).default('localhost:9092'),
    FLEET_KAFKA_CLIENT_ID: z.string().min(1).default('fleet-management-service'),
    FLEET_KAFKA_GROUP_ID: z.string().min(1).default('fleet-management-service'),
    /** Session-lifecycle topic produced by the device-gateway. */
    FLEET_KAFKA_SESSION_TOPIC: z.string().min(1).default('fleetvision.telemetry.session.lifecycle'),

    // --- Device commands (downstream TCP configuration, 06 §11.3). ---
    /** Command requests are produced here; the device-gateway consumes. */
    FLEET_KAFKA_COMMAND_REQUEST_TOPIC: z
      .string()
      .min(1)
      .default('fleetvision.telemetry.command.request'),
    /** Gateway feedback (sent/rejected) + device acks (D82) land here. */
    FLEET_KAFKA_COMMAND_ACK_TOPIC: z.string().min(1).default('fleetvision.telemetry.command.ack'),
    /** Default device-command TTL (seconds) — unacked commands EXPIRE past it. */
    FLEET_COMMAND_TTL_SECONDS: z.coerce.number().int().min(5).max(600).default(120),
    /** TTL sweeper interval (seconds). */
    FLEET_COMMAND_SWEEP_SECONDS: z.coerce.number().int().min(5).default(20),
    /**
     * Host the MDVR pushes RTMP to after AB2 (and A9A/A9D dialback host).
     * Same rule as md300 `live.js`: a public IPv4 is used as-is; empty or
     * RFC1918 is upgraded via ipify at boot so a cellular unit can reach :1935.
     */
    MDVR_PUBLIC_HOST: z.string().default(''),
    MDVR_PUBLIC_PORT: z.coerce.number().int().min(1).max(65535).default(6182),
    MDVR_RTMP_PORT: z.coerce.number().int().min(1).max(65535).default(1935),
    /** RTMP/HLS path advertised to the MDVR — md300-main uses `live/md300`. */
    MDVR_RTMP_PATH: z.string().min(1).default('live/md300'),
  }),
);

export type FleetManagementConfig = z.infer<typeof fleetManagementConfigSchema>;
