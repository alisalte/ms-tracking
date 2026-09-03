/**
 * Pagination caps used by dashboard list fetchers.
 *
 * Matches `MAX_PAGE_SIZE` in `@fleetvision/shared-kernel`. The web-dashboard
 * package does not depend on that kernel; keep the number here so list
 * helpers cannot request more than `pageRequestSchema` accepts.
 *
 * Services that bind `pageRequestSchema` (notification-service, fleet-service)
 * reject `limit > 100` with HTTP 400 `"limit must be <= 100"`. Do not confuse
 * this with fleet-management `listQuerySchema`, which allows 200.
 */
export const MAX_PAGE_SIZE = 100;
