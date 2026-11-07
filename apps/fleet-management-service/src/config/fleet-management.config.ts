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

/** `true`/`false`/`1`/`0` env flag → boolean (z.coerce.boolean treats "false" as true). */
const booleanFlag = z
  .enum(['true', 'false', '1', '0', 'TRUE', 'FALSE'])
  .transform((v) => v === 'true' || v === '1' || v === 'TRUE');

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

    /** Evidence capture worker poll interval (ms). 0 disables. */
    FLEET_EVIDENCE_WORKER_INTERVAL_MS: z.coerce.number().int().min(0).default(15_000),
    /** Max PENDING evidence jobs claimed per tick. */
    FLEET_EVIDENCE_WORKER_BATCH_SIZE: z.coerce.number().int().min(1).default(5),
    /** Alarm photos are scaled to this longest edge before storage. 0 keeps the original. */
    FLEET_EVIDENCE_PHOTO_MAX_EDGE: z.coerce.number().int().min(0).default(640),
    /** JPEG quality of stored alarm photos. */
    FLEET_EVIDENCE_PHOTO_QUALITY: z.coerce.number().int().min(1).max(100).default(50),

    // --- FTP alarm-photo receiver (MDVR B64, protocol V2.0 §3.45). ---
    /** Secret the per-device FTP passwords derive from. Empty disables the receiver. */
    FLEET_FTP_SECRET: z.string().default(''),
    /** Port the receiver listens on inside the container. */
    FLEET_FTP_PORT: z.coerce.number().int().min(1).max(65535).default(2121),
    /** Host/port sent to the unit in B64. Host defaults to MDVR_PUBLIC_HOST. */
    FLEET_FTP_PUBLIC_HOST: z.string().default(''),
    FLEET_FTP_PUBLIC_PORT: z.coerce.number().int().min(1).max(65535).default(21),
    /** Passive data ports (inclusive, `from-to`) — must be published 1:1. */
    FLEET_FTP_PASV_PORTS: z
      .string()
      .regex(/^\d+-\d+$/)
      .default('30000-30009'),
    FLEET_FTP_MAX_FILE_BYTES: z.coerce
      .number()
      .int()
      .min(1024)
      .default(5 * 1024 * 1024),

    // --- Driver photos: cabin snapshot on ignition-on → driver of the shift. ---
    /** Master switch for automatic cabin snapshots. */
    FLEET_DRIVER_PHOTO_ENABLED: booleanFlag.default('true'),
    /** Also take a snapshot when an MDVR connects (units that power up with the ignition). */
    FLEET_DRIVER_PHOTO_ON_CONNECT: booleanFlag.default('true'),
    /** Cabin (DMS) camera channel the snapshot is taken from. */
    FLEET_DRIVER_PHOTO_CAMERA: z.coerce.number().int().min(1).max(8).default(2),
    /** Seconds after ignition-on before the snapshot, so the driver is seated. */
    FLEET_DRIVER_PHOTO_DELAY_S: z.coerce.number().int().min(0).max(1800).default(45),
    /** At most one automatic snapshot per device in this many minutes. */
    FLEET_DRIVER_PHOTO_COOLDOWN_MIN: z.coerce.number().int().min(0).max(1440).default(30),
    /** Worker poll interval (ms). 0 disables the worker. */
    FLEET_DRIVER_PHOTO_WORKER_INTERVAL_MS: z.coerce.number().int().min(0).default(5_000),
    FLEET_DRIVER_PHOTO_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(10),
    /** Raw position topic watched for ignition OFF → ON. */
    FLEET_KAFKA_POSITION_TOPIC: z.string().min(1).default('fleetvision.telemetry.position.raw'),
    /**
     * face-service base URL (apps/face-service). It also grabs the snapshot
     * frame from the live stream, so empty = no driver photos are captured.
     */
    FLEET_FACE_SERVICE_URL: z.string().default(''),
    /** MediaMTX RTSP base face-service reads the cabin frame from. */
    FLEET_MEDIAMTX_RTSP_URL: z.string().default('rtsp://mediamtx:8554'),
    /** Minimum cosine similarity to a driver's confirmed photos for an automatic match. */
    FLEET_FACE_MATCH_THRESHOLD: z.coerce.number().min(0).max(1).default(0.4),
    /** Minimum lead of the best driver over the runner-up. */
    FLEET_FACE_MATCH_MARGIN: z.coerce.number().min(0).max(1).default(0.05),
  }),
);

export type FleetManagementConfig = z.infer<typeof fleetManagementConfigSchema>;
