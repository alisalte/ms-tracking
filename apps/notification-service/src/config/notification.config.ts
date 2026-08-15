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
  }),
);

export type NotificationConfig = z.infer<typeof notificationConfigSchema>;
