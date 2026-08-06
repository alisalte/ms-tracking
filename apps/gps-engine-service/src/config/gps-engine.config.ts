import { baseConfigSchema } from '@fleetvision/config';
import { z } from 'zod';

/**
 * gps-engine-service config schema (07 §1.5, §13).
 *
 * Extends the base schema (port, host, logLevel, environment) with the
 * infrastructure endpoints (Postgres/TimescaleDB, Redis, Kafka) and the
 * GPS-engine-specific knobs: consumer group, topics, WebSocket port, and the
 * freshness/stale thresholds that drive position quality + device status.
 *
 * Kafka/Redis/Postgres are non-fatal at boot (07 §15.4, mirroring the gateway):
 * the service starts even when they are down, reconnects lazily, and serves
 * cached/DB data meanwhile.
 */
export const gpsEngineConfigSchema = baseConfigSchema.merge(
  z.object({
    /** Postgres/TimescaleDB connection URL. */
    DBURL: z.string().min(1),
    /** Redis connection URL (last-position cache + device-status cache + WS adapter). */
    REDISURL: z.string().min(1),

    // --- Kafka (position consumer + session-lifecycle consumer) ---
    /** Comma-separated broker list, e.g. `localhost:9092`. */
    GPS_KAFKA_BROKERS: z.string().min(1).default('localhost:9092'),
    /** Kafka client id. */
    GPS_KAFKA_CLIENT_ID: z.string().min(1).default('gps-engine-service'),
    /** Consumer group id — per-partition, per-vehicle ordering (07 §3.6). */
    GPS_KAFKA_GROUP_ID: z.string().min(1).default('gps-engine-service'),
    /** Position input topic (produced by the device-gateway / ingestion). */
    GPS_KAFKA_POSITION_TOPIC: z.string().min(1).default('fleetvision.telemetry.position.raw'),
    /** Session-lifecycle topic (device online/offline/stale). */
    GPS_KAFKA_SESSION_TOPIC: z.string().min(1).default('fleetvision.telemetry.session.lifecycle'),

    // --- WebSocket (real-time broadcaster, 07 §11) ---
    /** WebSocket (Socket.IO) port. */
    GPS_WS_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    /** Enable/disable the WebSocket broadcaster (graceful disable for headless testing). */
    GPS_WS_ENABLED: z.coerce.boolean().default(true),

    // --- Position quality + freshness (07 §3.3, §3.4) ---
    /**
     * Default reporting interval (seconds) — used for the Redis last-position TTL
     * (2× interval) and as the stale-detection baseline.
     */
    GPS_REPORT_INTERVAL_SECONDS: z.coerce.number().int().min(1).default(60),
    /**
     * A position older than this (seconds) is tagged STALE — persisted but not
     * pushed live (07 §3.4). Default 300s per the spec.
     */
    GPS_STALE_AFTER_SECONDS: z.coerce.number().int().min(1).default(300),
    /** A position more than this many seconds in the future is REJECTED (07 §3.3). */
    GPS_FUTURE_THRESHOLD_SECONDS: z.coerce.number().int().min(1).default(60),

    // --- Trip FSM thresholds (07 §5.2; GPSEngine.md Appendix B) ---
    /** Speed above which movement is "real" (km/h). Default 10. */
    GPS_TRIP_START_SPEED_KMH: z.coerce.number().min(0).default(10),
    /** Sustained-movement duration to open a trip candidate (seconds). Default 30. */
    GPS_TRIP_START_DURATION_S: z.coerce.number().int().min(1).default(30),
    /** Discard micro-trips below this distance (meters). Default 250. */
    GPS_TRIP_MIN_DISTANCE_M: z.coerce.number().int().min(0).default(250),
    /** Speed at/below which the vehicle is "stationary" (km/h). Default 3. */
    GPS_TRIP_STOP_SPEED_KMH: z.coerce.number().min(0).default(3),
    /** Stationary duration that closes a trip (seconds). Default 300. */
    GPS_TRIP_MIN_STOP_DURATION_S: z.coerce.number().int().min(1).default(300),
    /** GPS gap above this breaks a trip (seconds). Default 600. */
    GPS_TRIP_MAX_GAP_S: z.coerce.number().int().min(1).default(600),

    // --- Idle FSM thresholds (07 §5.4; GPSEngine.md §5) ---
    /** Speed at/below which the vehicle is idle when ignition is on (km/h). Default 1. */
    GPS_IDLE_SPEED_KMH: z.coerce.number().min(0).default(1),
    /** Stationary+ignition-on duration to open an idle window (seconds). Default 180. */
    GPS_IDLE_THRESHOLD_S: z.coerce.number().int().min(1).default(180),
    /** Idle duration that triggers an alert (seconds). Default 900. */
    GPS_IDLE_ALERT_THRESHOLD_S: z.coerce.number().int().min(1).default(900),

    // --- Parking FSM threshold (07 §5.5) ---
    /** Ignition-off + stationary duration to enter parking (seconds). Default 1800. */
    GPS_PARKING_THRESHOLD_S: z.coerce.number().int().min(1).default(1800),

    // --- Mileage filters (07 §4.3; GPSEngine.md §6.3) ---
    /** Ignore distance steps shorter than this (meters). Default 1. */
    GPS_MILEAGE_DEDUPE_DISTANCE_M: z.coerce.number().min(0).default(1),
    /** Ignore steps implying a speed above this (km/h jump filter). Default 300. */
    GPS_MILEAGE_MAX_SPEED_KMH: z.coerce.number().min(0).default(300),
  }),
);

export type GpsEngineConfig = z.infer<typeof gpsEngineConfigSchema>;
