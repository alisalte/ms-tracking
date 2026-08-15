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
    DBURL: z
      .string()
      .min(1)
      .default('postgres://fleetvision:fleetvision@localhost:5432/fleetvision'),

    // --- Redis (cache + future use). ---
    REDISURL: z.string().min(1).default('redis://localhost:6379/2'),

    // --- Kafka consumer (session lifecycle → device connection state). ---
    FLEET_KAFKA_BROKERS: z.string().min(1).default('localhost:9092'),
    FLEET_KAFKA_CLIENT_ID: z.string().min(1).default('fleet-management-service'),
    FLEET_KAFKA_GROUP_ID: z.string().min(1).default('fleet-management-service'),
    /** Session-lifecycle topic produced by the device-gateway. */
    FLEET_KAFKA_SESSION_TOPIC: z.string().min(1).default('fleetvision.telemetry.session.lifecycle'),
  }),
);

export type FleetManagementConfig = z.infer<typeof fleetManagementConfigSchema>;
