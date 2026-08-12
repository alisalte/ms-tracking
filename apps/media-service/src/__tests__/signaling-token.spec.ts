/**
 * Signaling token tests — mint + verify (10 §5.4, INV-LV1).
 *
 * The token is the opaque per-stream credential that binds a viewer to a
 * session. These tests pin the mint/verify contract including expiry and
 * session/tenant binding — the properties the WS auth middleware relies on.
 */
import { describe, expect, it } from '@jest/globals';

import { mintSignalingToken, verifySignalingToken } from '../domain/signaling-token.js';

const NOW = new Date('2026-08-10T12:00:00Z');

const baseInput = {
  sessionId: 'sess-1',
  channelId: 'ch-1',
  tenantId: 'tenant-1',
  userId: 'user-1',
  quality: 'auto',
};

describe('mintSignalingToken (10 §5.4)', () => {
  it('produces a 64-char hex token (256 bits of entropy)', () => {
    const { token } = mintSignalingToken({ ...baseInput, now: NOW });
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it('two consecutive mints produce distinct tokens', () => {
    const a = mintSignalingToken({ ...baseInput, now: NOW });
    const b = mintSignalingToken({ ...baseInput, now: NOW });
    expect(a.token).not.toBe(b.token);
  });

  it('binds the payload to the requested session/channel/tenant/user', () => {
    const { payload } = mintSignalingToken({ ...baseInput, now: NOW });
    expect(payload).toMatchObject({
      sessionId: 'sess-1',
      channelId: 'ch-1',
      tenantId: 'tenant-1',
      userId: 'user-1',
      quality: 'auto',
    });
  });

  it('uses a 5-minute TTL by default', () => {
    const { payload } = mintSignalingToken({ ...baseInput, now: NOW });
    const fiveMin = 5 * 60 * 1000;
    expect(payload.expiresAt - NOW.getTime()).toBe(fiveMin);
  });

  it('honours a custom TTL', () => {
    const { payload } = mintSignalingToken({ ...baseInput, now: NOW, ttlMs: 60_000 });
    expect(payload.expiresAt - NOW.getTime()).toBe(60_000);
  });

  it('supports an anonymous (null-user) session', () => {
    const { payload } = mintSignalingToken({ ...baseInput, userId: null, now: NOW });
    expect(payload.userId).toBeNull();
  });
});

describe('verifySignalingToken (10 §5.4)', () => {
  it('accepts a valid, unexpired token for the matching session + tenant', () => {
    const token = mintSignalingToken({ ...baseInput, now: NOW });
    expect(verifySignalingToken(token, { sessionId: 'sess-1', tenantId: 'tenant-1' }, NOW)).toBe(
      true,
    );
  });

  it('rejects a token whose sessionId differs', () => {
    const token = mintSignalingToken({ ...baseInput, now: NOW });
    expect(
      verifySignalingToken(token, { sessionId: 'other-sess', tenantId: 'tenant-1' }, NOW),
    ).toBe(false);
  });

  it('rejects a token whose tenantId differs', () => {
    const token = mintSignalingToken({ ...baseInput, now: NOW });
    expect(
      verifySignalingToken(token, { sessionId: 'sess-1', tenantId: 'other-tenant' }, NOW),
    ).toBe(false);
  });

  it('rejects an expired token', () => {
    const token = mintSignalingToken({ ...baseInput, now: NOW });
    const afterExpiry = new Date(NOW.getTime() + 5 * 60 * 1000 + 1);
    expect(
      verifySignalingToken(token, { sessionId: 'sess-1', tenantId: 'tenant-1' }, afterExpiry),
    ).toBe(false);
  });

  it('accepts a token checked exactly at the expiry instant (boundary is exclusive)', () => {
    const token = mintSignalingToken({ ...baseInput, now: NOW });
    const atExpiry = new Date(NOW.getTime() + 5 * 60 * 1000);
    expect(
      verifySignalingToken(token, { sessionId: 'sess-1', tenantId: 'tenant-1' }, atExpiry),
    ).toBe(false);
  });
});
