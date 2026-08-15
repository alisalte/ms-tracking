/**
 * useSilentRefresh — proactive access-token rotation (Sprint E §5).
 *
 * The axios interceptor already recovers reactively on a 401; this hook ADDS
 * proactive rotation: it decodes the access token's `exp` (JWT payload — no
 * crypto, just base64url) and schedules `refreshTokens()` ~60s before expiry,
 * rescheduling on every rotation. On refresh failure the store/session is
 * cleared by the interceptor path and the next navigation hits /login.
 *
 * Mount once inside the authenticated app layout.
 */
import { useEffect } from 'react';

import { useAuthStore } from '@/auth/auth.store';

/** Seconds before expiry to rotate (clamped to >= 5s). */
const ROTATE_BEFORE_SECONDS = 60;

function accessTokenExpiresIn(token: string | null): number | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'))) as {
      exp?: number;
    };
    if (typeof payload.exp !== 'number') return null;
    return payload.exp - Math.floor(Date.now() / 1000);
  } catch {
    return null;
  }
}

export function useSilentRefresh() {
  const accessToken = useAuthStore((s) => s.accessToken);
  const refreshTokens = useAuthStore((s) => s.refreshTokens);

  useEffect(() => {
    const remaining = accessTokenExpiresIn(accessToken);
    if (remaining === null) return;
    const delayMs = Math.max(remaining - ROTATE_BEFORE_SECONDS, 5) * 1000;
    // Access TTL is 15 min → one refresh per ~14 min while the tab is open.
    const timer = setTimeout(() => {
      void refreshTokens();
    }, delayMs);
    return () => clearTimeout(timer);
  }, [accessToken, refreshTokens]);
}
