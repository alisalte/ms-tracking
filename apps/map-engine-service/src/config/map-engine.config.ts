import { authConfigSchema } from '@fleetvision/auth';
import { baseConfigSchema } from '@fleetvision/config';
import { z } from 'zod';

/**
 * map-engine-service config schema (08 §1.5, §2).
 *
 * Extends the base schema with the infrastructure endpoints (Postgres/PostGIS,
 * Redis) and the map-engine-specific knobs: provider selection, cache TTLs,
 * and optional external-provider credentials. External providers are non-fatal
 * at boot — the local provider is the default fallback.
 *
 * Sprint B merges `authConfigSchema` so the service verifies the same JWT as
 * identity-service.
 */
export const mapEngineConfigSchema = baseConfigSchema.merge(authConfigSchema).merge(
  z.object({
    /** Postgres/PostGIS connection URL (the geo + tracking schemas live here). */
    DBURL: z.string().min(1),
    /** Redis connection URL (three-tier geo cache). */
    REDISURL: z.string().min(1),

    /**
     * Override the base default (3000) — map-engine REST listens on 3009 to
     * match the web-dashboard dev proxy + nginx upstream (Sprint F).
     */
    PORT: z.coerce.number().int().min(1).max(65535).default(3009),

    // --- Provider selection (08 §2.3; Sprint F §5) ---
    /** Default provider when no region/tenant pin applies: 'local' | 'osrm' | 'nominatim'. */
    MAP_DEFAULT_PROVIDER: z.string().default('local'),
    /** Provider region override: 'global' | 'china'. China → Amap/Baidu (stubbed). */
    MAP_PROVIDER_REGION: z.string().default('global'),

    // --- Optional external providers (empty = provider not registered) ---
    MAPBOX_TOKEN: z.string().default(''),
    /** OSRM-compatible routing server base URL (e.g. http://localhost:5000). Empty = no real routing. */
    OSRM_URL: z.string().default(''),
    /** OSRM profile the server was built with (driving | car | bike | foot). */
    OSRM_PROFILE: z.string().default('driving'),
    /** Nominatim (geocoding) base URL. Empty = geocoding falls back to the local geo.addresses provider. */
    NOMINATIM_URL: z.string().default(''),
    /** User-Agent for Nominatim requests (public-instance usage policy requires identification). */
    NOMINATIM_USER_AGENT: z.string().default('FleetVision-MapEngine/1.0'),
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
