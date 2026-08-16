import { authConfigSchema } from '@fleetvision/auth';
import { baseConfigSchema } from '@fleetvision/config';
import { z } from 'zod';

/**
 * reporting-service config schema.
 *
 * The service is a READ-ONLY analytical layer over the shared PostgreSQL
 * (tracking + notification + fleet schemas). Sprint B merges `authConfigSchema`
 * so JWT verification matches identity-service.
 */
export const reportingConfigSchema = baseConfigSchema.merge(authConfigSchema).merge(
  z.object({
    /** PostgreSQL connection URL (the same shared database as the domain services). */
    DBURL: z.string().min(1),
    /** Redis connection URL (bounded-TTL report cache + export rate limiting). */
    REDISURL: z.string().min(1),

    /** reporting-service REST port (3011 — after map-engine 3009, notification 3008). */
    PORT: z.coerce.number().int().min(1).max(65535).default(3011),

    // --- Sprint J bounds ---
    /**
     * Maximum custom report range (days). Documented deviation from the
     * 31-day HISTORY policy: quarter-scale daily/weekly/monthly trends for
     * AGGREGATED reporting; still bounded (never unlimited analytics).
     */
    REPORT_MAX_RANGE_DAYS: z.coerce.number().int().min(1).default(92),
    /** Per-query statement timeout (ms) — bounded execution for every report. */
    REPORT_QUERY_TIMEOUT_MS: z.coerce.number().int().min(500).default(15_000),
    /** Fleet-overview / trend cache TTL (seconds, bounded). */
    REPORT_CACHE_TTL_SECONDS: z.coerce.number().int().min(1).default(30),
    /** CSV export rate limit (requests per window per tenant+user). */
    REPORT_EXPORT_RATE_LIMIT: z.coerce.number().int().min(1).default(30),
    /** CSV export rate-limit window (seconds). */
    REPORT_EXPORT_RATE_WINDOW_SECONDS: z.coerce.number().int().min(1).default(60),
    /** Max rows per CSV export (batched streaming in chunks up to this cap). */
    REPORT_EXPORT_MAX_ROWS: z.coerce.number().int().min(100).default(50_000),
    /** Page size cap for list reports. */
    REPORT_MAX_PAGE_SIZE: z.coerce.number().int().min(1).default(200),

    /** Expose GET /metrics (Prometheus) — report counters/histograms. */
    REPORT_METRICS_ENABLED: z.coerce.boolean().default(true),
  }),
);

export type ReportingConfig = z.infer<typeof reportingConfigSchema>;
