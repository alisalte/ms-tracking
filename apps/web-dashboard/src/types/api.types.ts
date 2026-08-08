/**
 * API response envelope types.
 *
 * FleetVision APIs use a JSON:API-inspired envelope: `{ data: T }` for success
 * and `{ errors: ApiError[] }` for failures (see packages/web error envelope).
 */

/** Successful API response envelope. */
export interface ApiResponse<T> {
  data: T;
}

/** Single API error object (JSON:API-aligned). */
export interface ApiError {
  code: string;
  status: number;
  title: string;
  detail: string;
  source?: { pointer?: string; parameter?: string };
  meta?: Record<string, unknown>;
}

/** Error response envelope. */
export interface ApiErrorResponse {
  errors: ApiError[];
}

/** Paginated collection with cursor-based pagination. */
export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    nextCursor: string | null;
    hasMore: boolean;
  };
}
