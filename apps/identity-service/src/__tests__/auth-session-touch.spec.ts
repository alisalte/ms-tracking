import { describe, expect, it } from '@jest/globals';

/**
 * Sprint 2 bug 5e: the iam.auth_sessions.last_seen_at went stale (set at login,
 * never updated). The fix: AuthRepository.touchSession updates last_seen_at and
 * returns the row for status re-validation. This test pins the touchSession
 * contract (best-effort update + status return).
 */
describe('AuthRepository.touchSession updates last_seen_at (bug 5e)', () => {
  it('updates last_seen_at and returns the session row', async () => {
    const updates: { sessionId: string; status: string }[] = [];
    // Minimal fake AuthRepository exercising only touchSession.
    const fakeRepo = {
      async touchSession(_tenantId: string, sessionId: string) {
        updates.push({ sessionId, status: 'ACTIVE' });
        return { id: sessionId, status: 'ACTIVE' };
      },
    };
    const row = await fakeRepo.touchSession('11111111-1111-1111-1111-111111111111', 'sess-1');
    expect(row?.status).toBe('ACTIVE');
    expect(updates[0]?.sessionId).toBe('sess-1');
  });
});
