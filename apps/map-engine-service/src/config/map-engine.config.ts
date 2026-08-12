import { baseConfigSchema } from '@fleetvision/config';
import { z } from 'zod';

/**
 * map-engine-service config schema (08 §1.5, §2).
 *
 * Extends the base schema with the infrastructure endpoints (Postgres/PostGIS,
 * Redis) and the map-engine-specific knobs: provider selection, cache TTLs,
 * and optional external-provider credentials. External providers are non-fatal
 * at boot — the local provider is the default fallback.
 */
export const mapEngineConfigSchema = baseConfigSchema.merge(
  z.object({
    /** Postgres/PostGIS connection URL (the geo + tracking schemas live here). */
    DBURL: z.string().min(1),
    /** Redis connection URL (three-tier geo cache). */
    REDISURL: z.string().min(1),

    // --- JWT verification (same HS256 token issued by identity-service) ---
    JWT_SECRET: z.string().min(32),
    JWT_ISSUER: z.string().min(1).default('fleetvision'),
    JWT_AUDIENCE: z.string().min(1).default('fleetvision-identity'),

    // --- Provider selection (08 §2.3) ---
    /** Default provider when no region/tenant pin applies: 'local' | 'mapbox'. */
    MAP_DEFAULT_PROVIDER: z.string().default('local'),
    /** Provider region override: 'global' | 'china'. China → Amap/Baidu (stubbed). */
    MAP_PROVIDER_REGION: z.string().default('global'),

    // --- Optional external credentials (empty = provider unavailable) ---
    MAPBOX_TOKEN: z.string().default(''),
    OSRM_URL: z.string().default(''),
    GOOGLE_MAPS_KEY: z.string().default(''),

    // --- Cache TTLs (08 §6.1) ---
    /** Geo cache TTL in seconds (geocode, route, cluster, snap). Default 300s. */
    MAP_CACHE_TTL_SECONDS: z.coerce.number().int().min(1).default(300),
    /** Cluster cache TTL in seconds (08 §3.3 — shorter for freshness). Default 5s. */
    MAP_CLUSTER_CACHE_TTL_SECONDS: z.coerce.number().int().min(1).default(5),
    /** Replay cache TTL in seconds (08 §9.3). Default 600s (10min). */
    MAP_REPLAY_CACHE_TTL_SECONDS: z.coerce.number().int().min(1).default(600),

    // --- Clustering thresholds (08 §3.3, §6.3) ---
    /** Vehicle count above which server-side clustering kicks in. Default 2000. */
    MAP_CLUSTER_THRESHOLD: z.coerce.number().int().min(1).default(2000),
    /** Max cluster markers returned. Default 100. */
    MAP_MAX_CLUSTERS: z.coerce.number().int().min(1).default(100),
  }),
);

export type MapEngineConfig = z.infer<typeof mapEngineConfigSchema>;
