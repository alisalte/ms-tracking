import { authConfigSchema } from '@fleetvision/auth';
import { baseConfigSchema } from '@fleetvision/config';
import { z } from 'zod';

/**
 * media-service config schema (09 §1.5, §7).
 *
 * The media service is the control-plane orchestrator for the Media & Video
 * context. It manages channels, stream sessions, protocol adapters, and WebSocket
 * signaling. The actual media-router/SFU is an infra-class dependency reached via
 * the MEDIA_ROUTER_URL gRPC endpoint — non-fatal at boot (the service starts even
 * when the router is down, serving metadata + signaling token minting).
 *
 * Sprint B merges `authConfigSchema` so the service verifies the same JWT as
 * identity-service.
 */
export const mediaConfigSchema = baseConfigSchema.merge(authConfigSchema).merge(
  z.object({
    /** Postgres connection URL (media.* schema). */
    DBURL: z.string().min(1),
    /** Redis connection URL (signaling tokens + channel→pod affinity). */
    REDISURL: z.string().min(1),

    // --- Kafka (media events) ---
    MEDIA_KAFKA_BROKERS: z.string().min(1).default('localhost:9092'),
    MEDIA_KAFKA_CLIENT_ID: z.string().min(1).default('media-service'),
    MEDIA_KAFKA_CHANNEL_TOPIC: z.string().min(1).default('fleetvision.media.channel.events'),
    MEDIA_KAFKA_STREAM_TOPIC: z.string().min(1).default('fleetvision.media.stream.events'),

    // --- WebSocket signaling (09 §3.7, 10 §4) ---
    MEDIA_WS_PORT: z.coerce.number().int().min(1).max(65535).default(3002),
    MEDIA_WS_ENABLED: z.coerce.boolean().default(true),

    // --- Media router / SFU (infra-class, 09 §1.4) ---
    /** gRPC URL of the media-router/SFU (empty = stub mode). */
    MEDIA_ROUTER_URL: z.string().default(''),

    // --- ICE / NAT (10 §3.3) ---
    MEDIA_STUN_URL: z.string().default('stun:stun.l.google.com:19302'),
    MEDIA_TURN_URL: z.string().default(''),

    // --- Session defaults ---
    /** Signaling token TTL in seconds (10 §5.4 — 5min sliding). */
    /**
     * Comma-separated allowed CORS origins for the signaling WebSocket (Sprint B).
     * Empty (default) = no cross-origin browser clients. NEVER `*` in production.
     */
    MEDIA_WS_CORS_ORIGIN: z.string().default(''),
    MEDIA_SIGNALING_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).default(300),
    /** Idle close timeout — source torn down after this with 0 viewers (09 §3.8). */
    MEDIA_IDLE_CLOSE_SECONDS: z.coerce.number().int().min(60).default(300),
  }),
);

export type MediaConfig = z.infer<typeof mediaConfigSchema>;
