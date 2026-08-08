/**
 * Mock-gate system — controls whether mock data is used instead of real API calls.
 *
 * In production builds (`import.meta.env.PROD`), mocks are ALWAYS disabled — the
 * mock modules are never imported, keeping the production bundle lean and
 * guaranteeing the app only talks to real backends.
 *
 * In development/test, the `VITE_USE_MOCK` env var (default `true`) controls
 * the behavior:
 * - `true` (default): try the real API first; on network error, fall back to mock.
 * - `false`: always use the real API (no mock fallback).
 *
 * Individual API modules use `shouldUseMock()` to decide, and `withMockFallback()`
 * to implement the try-real-then-fallback pattern.
 */

/**
 * Whether mock data should be used at all.
 *
 * - Production: never (returns false unconditionally — tree-shakes mocks).
 * - Dev/test: true unless `VITE_USE_MOCK=false` is explicitly set.
 */
export function shouldUseMock(): boolean {
  // Production builds NEVER use mock data.
  if (import.meta.env.PROD) return false;

  // Dev/test: respect VITE_USE_MOCK (default true).
  const flag = import.meta.env.VITE_USE_MOCK;
  return flag !== 'false' && flag !== '0';
}

/**
 * Try a real API call first; if it fails with a network error (server not
 * running) in dev/test mode, fall back to the mock fetcher.
 *
 * In production, the mock fetcher is never called (it's behind `shouldUseMock`).
 *
 * @param realFetch The real API call (apiGet/apiPost).
 * @param mockFetch The mock data resolver (only called on network failure in dev).
 * @returns The data from the real call, or the mock fallback.
 */
export async function withMockFallback<T>(
  realFetch: () => Promise<T>,
  mockFetch: () => Promise<T>,
): Promise<T> {
  // Production: always real, no fallback.
  if (!shouldUseMock()) {
    return realFetch();
  }

  // Dev/test with mock fallback: try real, fall back on network error.
  try {
    return await realFetch();
  } catch (err) {
    // Only fall back to mock on network errors (server not running), NOT on
    // real HTTP errors (401/403/404/500 etc.) — those mean the server IS
    // running and returned a legitimate error.
    if (isNetworkError(err)) {
      return mockFetch();
    }
    throw err;
  }
}

/** Check if an error is a network error (no HTTP response — server unreachable). */
function isNetworkError(err: unknown): boolean {
  if (err instanceof Error) {
    return (
      err.name === 'NetworkError' ||
      err.message.includes('Network Error') ||
      err.message.includes('ECONNREFUSED') ||
      err.message.includes('ERR_NETWORK') ||
      err.message.includes('timeout')
    );
  }
  return false;
}

/** Simulated network latency for mock responses (dev/test only). */
export const MOCK_LATENCY_MS = 250;

/** Resolve mock data after a short delay (mimics network latency). */
export function resolveMock<T>(data: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(data), MOCK_LATENCY_MS));
}
