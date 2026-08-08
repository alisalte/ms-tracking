/**
 * Shared error helpers.
 *
 * `NotImplementedError` marks API stub functions that mirror a documented
 * endpoint the backend has not implemented yet (see Sprint FE-2 plan). Each
 * stub throws this with the exact HTTP method + path so a backend landing the
 * endpoint is a one-line swap: replace the throw with the real `apiPost` call.
 */
export class NotImplementedError extends Error {
  constructor(
    /** Documented HTTP method + path, e.g. `POST /auth/register`. */
    public readonly endpoint: string,
  ) {
    super(`${endpoint} is not implemented in identity-service yet.`);
    this.name = 'NotImplementedError';
  }
}

/** Type guard for `NotImplementedError`. */
export function isNotImplemented(error: unknown): error is NotImplementedError {
  return error instanceof NotImplementedError;
}
