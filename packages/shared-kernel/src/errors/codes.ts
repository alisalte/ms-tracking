/**
 * Canonical error-code catalog. These are the API-facing error codes that the
 * JSON:API error envelope returns (API_Design.md §8.3). Keeping them in one
 * governed place prevents drift between services and the API spec — the same
 * reason the permission catalog is centralized (01 §9.2).
 *
 * Every code maps 1:1 to an HTTP status via HttpStatusByCode; the
 * GlobalExceptionFilter reads this map rather than keeping a parallel switch.
 */
export const ErrorCodes = {
  // --- Generic ---
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  BAD_REQUEST: 'BAD_REQUEST',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  BUSINESS_RULE_VIOLATION: 'BUSINESS_RULE_VIOLATION',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  RATE_LIMITED: 'RATE_LIMITED',
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
  BAD_REQUEST: 400,
  VALIDATION_ERROR: 400,
  BUSINESS_RULE_VIOLATION: 422,
  NOT_FOUND: 404,
  CONFLICT: 409,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  RATE_LIMITED: 429,
  CONFIG_INVALID: 500,
  DB_UNAVAILABLE: 503,
  CACHE_UNAVAILABLE: 503,
};
