/**
 * API error system — structured transport errors with HTTP status codes.
 *
 * The response interceptor in `client.ts` normalizes every non-2xx response
 * into one of these. Each subclass carries the HTTP status so callers can
 * `instanceof`-check for specific handling (e.g. 401 → redirect, 403 →
 * permission UI, 409 → conflict toast).
 */

/** Base structured API error. Carries the HTTP status + backend error code. */
export class ApiClientError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string | undefined,
    message: string,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

/** 401 Unauthorized — token expired/invalid. Triggers refresh or redirect. */
export class UnauthorizedError extends ApiClientError {
  constructor(code: string | undefined, message: string) {
    super(401, code, message);
    this.name = 'UnauthorizedError';
  }
}

/** 403 Forbidden — authenticated but lacking the required permission. */
export class ForbiddenError extends ApiClientError {
  constructor(code: string | undefined, message: string) {
    super(403, code, message);
    this.name = 'ForbiddenError';
  }
}

/** 404 Not Found — resource does not exist. */
export class NotFoundError extends ApiClientError {
  constructor(code: string | undefined, message: string) {
    super(404, code, message);
    this.name = 'NotFoundError';
  }
}

/** 409 Conflict — duplicate / state-transition violation. */
export class ConflictError extends ApiClientError {
  constructor(code: string | undefined, message: string) {
    super(409, code, message);
    this.name = 'ConflictError';
  }
}

/** 422 Unprocessable Entity — validation failure. */
export class ValidationError extends ApiClientError {
  constructor(code: string | undefined, message: string) {
    super(422, code, message);
    this.name = 'ValidationError';
  }
}

/** 5xx Server Error. */
export class ServerError extends ApiClientError {
  constructor(code: string | undefined, message: string) {
    super(500, code, message);
    this.name = 'ServerError';
  }
}

/** Network error — server unreachable / DNS failure / timeout (no HTTP response). */
export class NetworkError extends ApiClientError {
  constructor(message: string) {
    super(0, 'NETWORK_ERROR', message);
    this.name = 'NetworkError';
  }
}

/**
 * Normalize an Axios error into the appropriate ApiClientError subclass.
 *
 * Called by the response interceptor. The status → class mapping is:
 * - No response → NetworkError
 * - 401 → UnauthorizedError
 * - 403 → ForbiddenError
 * - 404 → NotFoundError
 * - 409 → ConflictError
 * - 422 → ValidationError
 * - 5xx → ServerError
 * - Other → generic ApiClientError
 */
export function normalizeApiError(error: {
  response?: { status: number; data?: unknown };
  message: string;
}): ApiClientError {
  const { response, message } = error;

  // No HTTP response → network error / timeout.
  if (!response) {
    return new NetworkError(message);
  }

  const status = response.status;
  const errorData = response.data as
    | { errors?: Array<{ code?: string; detail?: string; title?: string }> }
    | undefined;
  const first = errorData?.errors?.[0];
  const code = first?.code;
  const detail = first?.detail ?? first?.title ?? message;

  switch (status) {
    case 401:
      return new UnauthorizedError(code, detail);
    case 403:
      return new ForbiddenError(code, detail);
    case 404:
      return new NotFoundError(code, detail);
    case 409:
      return new ConflictError(code, detail);
    case 422:
      return new ValidationError(code, detail);
    default:
      if (status >= 500) return new ServerError(code, detail);
      return new ApiClientError(status, code, detail);
  }
}

/**
 * Extract a human-readable message from any error.
 * Falls back to a generic message if the error is not structured.
 */
export function getApiErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return 'An unexpected error occurred';
}
