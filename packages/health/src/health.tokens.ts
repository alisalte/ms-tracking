/**
 * DI tokens for @fleetvision/health.
 *
 * Lives in its own module (NOT health.module) to break the
 * health.module ↔ health.controller import cycle: the controller injects this
 * token while health.module imports the controller, so a module-graph entry
 * via health.module hit the token's TDZ and crashed service boot at require
 * time (surfaced by the Sprint E fleet-management E2E). The
 * `ReadinessIndicator` type lives here for the same reason.
 */

/**
 * Extra readiness indicators (Sprint D §35). A service module provides a value
 * for this token to contribute readiness checks (e.g. the gateway's
 * Kafka-producer state, gps-engine's consumer-running state) without the
 * health package depending on it.
 */
export const EXTRA_READINESS_INDICATORS = 'HEALTH_EXTRA_READINESS_INDICATORS';

/** A terminus health-check function (`() => HealthIndicatorResult`). */
export type ReadinessIndicator = () => Promise<import('@nestjs/terminus').HealthIndicatorResult>;
