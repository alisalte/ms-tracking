import { baseConfigSchema } from '@fleetvision/config';
import { z } from 'zod';

/**
 * notification-service config schema.
 *
 * Consumes the same Kafka topics as gps-engine-service (position.raw +
 * session.lifecycle) with its own consumer group so alarm evaluation runs
 * independently. JWT verification uses the same HS256 secret as all services.
 */
export const notificationConfigSchema = baseConfigSchema.merge(
  z.object({
    /**
     * Override the base default (3000) — notification-service REST listens on
     * 3008 to match the web-dashboard dev proxy + nginx upstream (Sprint E).
     */
    PORT: z.coerce.number().int().min(1).max(65535).default(3008),

    DBURL: z.string().min(1),
    DBURL_PLATFORM: z.string().min(1).optional(),
    REDISURL: z.string().min(1),

    // --- JWT verification (same HS256 token issued by identity-service) ---
    JWT_SECRET: z.string().min(32),
    JWT_ISSUER: z.string().min(1).default('fleetvision'),
    JWT_AUDIENCE: z.string().min(1).default('fleetvision-identity'),

    // --- Kafka (consume the same telemetry topics as gps-engine) ---
    NOTIF_KAFKA_BROKERS: z.string().min(1).default('localhost:9092'),
    NOTIF_KAFKA_CLIENT_ID: z.string().min(1).default('notification-service'),
    NOTIF_KAFKA_GROUP_ID: z.string().min(1).default('notification-service'),
    NOTIF_KAFKA_POSITION_TOPIC: z.string().min(1).default('fleetvision.telemetry.position.raw'),
    NOTIF_KAFKA_SESSION_TOPIC: z.string().min(1).default('fleetvision.telemetry.session.lifecycle'),
    /**
     * Sprint G — the gps-engine FleetEvent topic (trip/idle/parking boundaries
     * + device-status transitions, CloudEvents `tracking.event.v1`).
     */
    NOTIF_KAFKA_TRACKING_EVENT_TOPIC: z.string().min(1).default('fleetvision.tracking.events'),
    /** Device-origin alarms (DMS/ADAS/SOS/…) published by the device-gateway. */
    NOTIF_KAFKA_DEVICE_ALARM_TOPIC: z.string().min(1).default('fleetvision.telemetry.alarm.raw'),
    /** Sprint G — bounded in-process attempts per message before DLQ. */
    NOTIF_KAFKA_MAX_ATTEMPTS: z.coerce.number().int().min(1).default(3),
    /** Sprint G — initial retry backoff (ms), doubling per attempt. */
    NOTIF_KAFKA_RETRY_BACKOFF_MS: z.coerce.number().int().min(10).default(250),
    /** Sprint G — enable the Kafka consumer (off for REST/WS-only test boots). */
    NOTIF_KAFKA_CONSUMER_ENABLED: z.coerce.boolean().default(true),
    /**
     * Sprint G — subscribe from the beginning of each topic (fresh consumer
     * groups in integration tests; production keeps the default `false` so a
     * redeployed group resumes at the committed offsets/latest).
     */
    NOTIF_KAFKA_FROM_BEGINNING: z.coerce.boolean().default(false),

    // --- Alarm rule cache (Sprint G Part 38) ---
    /** TTL for the Redis-cached enabled-rule set per tenant (seconds). */
    NOTIF_RULE_CACHE_TTL_SECONDS: z.coerce.number().int().min(1).default(30),

    // --- Metrics (Sprint G Part 36) ---
    NOTIF_METRICS_ENABLED: z.coerce.boolean().default(true),

    // --- WebSocket (alarm + notification realtime push) ---
    NOTIF_WS_PORT: z.coerce.number().int().min(1).max(65535).default(3010),
    NOTIF_WS_ENABLED: z.coerce.boolean().default(true),
    NOTIF_WS_CORS_ORIGIN: z.string().default('*'),

    // --- Email (optional — SMTP; email channel disabled when unset) ---
    NOTIF_SMTP_HOST: z.string().optional(),
    NOTIF_SMTP_PORT: z.coerce.number().int().min(1).max(65535).optional(),
    NOTIF_SMTP_USER: z.string().optional(),
    NOTIF_SMTP_PASS: z.string().optional(),
    NOTIF_SMTP_FROM: z.string().email().optional(),

    // --- Sprint H: Notification Center ---------------------------------------
    /**
     * Master switch for the notification dispatch tier (recipient fan-out +
     * channel dispatch). When false, the alarm engine still runs but no
     * notifications are created.
     */
    NOTIFICATION_ENABLED: z.coerce.boolean().default(true),
    /** SMS channel — no real provider is integrated; stays false (DISABLED). */
    NOTIF_SMS_ENABLED: z.coerce.boolean().default(false),
    /** PUSH channel — no real provider is integrated; stays false (DISABLED). */
    NOTIF_PUSH_ENABLED: z.coerce.boolean().default(false),
    /** Max delivery attempts per channel before terminal FAILED (Sprint H §31). */
    NOTIF_MAX_DELIVERY_ATTEMPTS: z.coerce.number().int().min(1).default(3),
    /** Initial retry backoff (ms), doubling per attempt (2s → 4s → 8s). */
    NOTIF_RETRY_BASE_MS: z.coerce.number().int().min(100).default(2000),
    /** Retry worker sweep interval (ms); 0 disables the worker. */
    NOTIF_RETRY_WORKER_INTERVAL_MS: z.coerce.number().int().min(0).default(5000),
    /** Retry worker claim batch size per sweep. */
    NOTIF_RETRY_WORKER_BATCH_SIZE: z.coerce.number().int().min(1).default(50),
    /**
     * Rate limit per tenant+user+channel per 60s window (storm protection,
     * Sprint H §33). 0 disables limiting.
     */
    NOTIF_RATE_LIMIT_PER_MIN: z.coerce.number().int().min(0).default(30),
    /** Default notification locale when no user preference exists (fa | en). */
    NOTIF_DEFAULT_LOCALE: z.enum(['en', 'fa']).default('en'),
  }),
);

export type NotificationConfig = z.infer<typeof notificationConfigSchema>;
