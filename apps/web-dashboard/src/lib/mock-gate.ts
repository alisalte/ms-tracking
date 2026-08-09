/**
 * Mock-gate system — controls whether mock data is used instead of real API calls.
 *
 * Most FleetVision data services (analytics, fleet, tracking, weather) are not
 * implemented yet — only `identity-service` exists. So the dashboard/map/trips
 * pages are mock-backed by default, in dev AND production, so the UI is fully
 * demoable.
 *
 * Controls (checked in order):
 *   1. `localStorage.fleetvision_use_mock === 'false'` → mocks off (talk to real APIs).
 *   2. `?useMock=false` query param → mocks off for this session (sets the flag).
 *   3. `import.meta.env.VITE_USE_MOCK === 'false'` (build-time) → mocks off.
 *   4. otherwise → mocks ON (default).
 *
 * Individual API modules use `shouldUseMock()` to decide, and `withMockFallback()`
 * to implement the try-real-then-fallback pattern.
 */

const LS_KEY = 'fleetvision_use_mock';

function readRuntimeFlag(): boolean | null {
  // Query-param override (?useMock=false), persisted to localStorage so it
  // survives navigation/refresh.
  if (typeof window !== 'undefined') {
    const qp = new URLSearchParams(window.location.search).get('useMock');
    if (qp === 'false' || qp === '0') {
      window.localStorage.setItem(LS_KEY, 'false');
    } else if (qp === 'true' || qp === '1') {
      window.localStorage.setItem(LS_KEY, 'true');
    }
    const ls = window.localStorage.getItem(LS_KEY);
    if (ls === 'false' || ls === '0') return false;
    if (ls === 'true' || ls === '1') return true;
  }
  return null;
}

/**
 * Whether mock data should be used. Default: TRUE (so the dashboard/map/trips
 * render with data even when the backend services aren't deployed).
 */
export function shouldUseMock(): boolean {
  const runtime = readRuntimeFlag();
  if (runtime !== null) return runtime;
  // Build-time override.
  const flag = import.meta.env.VITE_USE_MOCK;
  return flag !== 'false' && flag !== '0';
}

/**
 * Try a real API call first; if it fails with a network error (server not
 * running), fall back to the mock fetcher.
 *
 * When `shouldUseMock()` is false (operator opted into real APIs via
 * `?useMock=false` or `VITE_USE_MOCK=false`), the mock fetcher is never called.
 *
 * @param realFetch The real API call (apiGet/apiPost).
 * @param mockFetch The mock data resolver (only called on network failure).
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
