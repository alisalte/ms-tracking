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

/**
 * A cursor-paginated page — matches the backend `Page<T>` shape
 * (`{ data: T[]; nextCursor: string | null }`). `nextCursor` is null when
 * the page is exhausted; pass it back as `?cursor=` to fetch the next page.
 */
export interface Page<T> {
  data: T[];
  nextCursor: string | null;
}

/**
 * Paginated collection with cursor-based pagination.
 * @deprecated Use {@link Page} (matches the backend shape). Retained for
 * backward compatibility with existing callers that haven't migrated.
 */
export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    nextCursor: string | null;
    hasMore: boolean;
  };
}
