import { describe, expect, it } from 'vitest';

import { getAccessToken } from '@/auth/token.storage';

/**
 * Sprint 3: the WS gateway (Sprint 1 hardening) requires the JWT on the
 * handshake. The useRealtimeSocket hook now passes `auth: { token }`.
 * This test verifies the token storage helper the hook depends on, so the
 * auth-token wiring is pinned.
 */
describe('realtime WS auth token', () => {
  it('getAccessToken returns the stored access token', () => {
    // The token.storage helper reads from localStorage.
    window.localStorage.setItem(
      'fleetvision_tokens',
      JSON.stringify({
        accessToken: 'test-jwt-token',
        refreshToken: 'test-refresh',
        tenantId: 'test-tenant',
      }),
    );
    expect(getAccessToken()).toBe('test-jwt-token');
    window.localStorage.removeItem('fleetvision_tokens');
  });

  it('getAccessToken returns null when no tokens are stored', () => {
    window.localStorage.removeItem('fleetvision_tokens');
    expect(getAccessToken()).toBeNull();
  });
});
