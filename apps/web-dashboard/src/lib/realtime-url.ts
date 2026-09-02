/**
 * Resolve a Socket.IO target for local Vite vs the nginx-fronted Docker image.
 *
 * - Absolute env URL (`http://localhost:3001`) → used as-is (dev).
 * - Path env (`/gps-ws`) → same origin + `/gps-ws/socket.io` (production SPA).
 * - Unset in DEV → localhost fallback.
 * - Unset in production build → same-origin nginx proxy path.
 */
export function resolveRealtimeTarget(
  envUrl: string | undefined,
  devFallback: string,
  prodSocketPath: string,
): { url: string; path: string } {
  const configured = envUrl?.trim();
  if (configured) {
    if (configured.startsWith('/')) {
      const origin = typeof window !== 'undefined' ? window.location.origin : '';
      return { url: origin, path: `${configured.replace(/\/$/, '')}/socket.io` };
    }
    return { url: configured, path: '/socket.io' };
  }
  if (import.meta.env.DEV) {
    return { url: devFallback, path: '/socket.io' };
  }
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return { url: origin, path: prodSocketPath };
}
