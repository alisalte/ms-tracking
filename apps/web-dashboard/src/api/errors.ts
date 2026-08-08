/**
 * Custom API error class with structured error information.
 */
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

/**
 * Extract a human-readable message from an API error response.
 * Falls back to a generic message if the response is not structured.
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
