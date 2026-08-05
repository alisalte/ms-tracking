/**
 * Canonical error-code catalog. These are the API-facing error codes that the
 * JSON:API error envelope returns (API_Design.md §8.3). Keeping them in one
 * governed place prevents drift between services and the API spec — the same
 * reason the permission catalog is centralized (01 §9.2).
 *
 * Sprint 1 ships the foundation subset; domain-specific codes are added per
 * bounded context as aggregates are implemented.
 */
export const ErrorCodes = {
  // --- Generic ---
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  // --- Config / boot ---
  CONFIG_INVALID: 'CONFIG_INVALID',
  // --- Infrastructure ---
  DB_UNAVAILABLE: 'DB_UNAVAILABLE',
  CACHE_UNAVAILABLE: 'CACHE_UNAVAILABLE',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

/** Maps a canonical HTTP status to each error code (exception filter uses this). */
export const HttpStatusByCode: Record<ErrorCode, number> = {
  INTERNAL_ERROR: 500,
  VALIDATION_ERROR: 400,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  CONFIG_INVALID: 500,
  DB_UNAVAILABLE: 503,
  CACHE_UNAVAILABLE: 503,
};
