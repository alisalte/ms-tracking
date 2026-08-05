/**
 * Infrastructure/cache layer for identity-service.
 *
 * Cache adapters (idempotency keys, rate-limit counters, short-lived token
 * blacklists) land here in later sprints. The RedisModule owns the client; these
 * are the service-specific facades over it. Intentionally empty for Sprint 1.
 */
export {};
