import { describe, expect, it } from '@jest/globals';
import { RefreshTokenReuseError } from '../domain/errors.js';
import type { EventContext } from '../domain/events.js';
import { RefreshTokenFamily } from '../domain/refresh-token-family.js';

const ctx: EventContext = {
  tenantId: 'tenant-1',
  correlationId: 'corr-1',
  aggregateType: 'refresh_token_family',
};

describe('RefreshTokenFamily (AUTH-BR-08 reuse detection)', () => {
  it('rotates a token on legitimate refresh', () => {
    const family = startFamily('hash-1');
    const result = family.consume(
      'hash-1',
      { jti: 'jti-2', tokenHash: 'hash-2', expiresAt: future() },
      ctx,
    );
    expect(result.outcome).toBe('ROTATED');
    expect(family.status).toBe('ACTIVE');
  });

  it('detects reuse of a consumed token and compromises the family', () => {
    const family = startFamily('hash-1');
    family.consume('hash-1', { jti: 'jti-2', tokenHash: 'hash-2', expiresAt: future() }, ctx);
    // Present hash-1 again → reuse.
    const result = family.consume(
      'hash-1',
      { jti: 'jti-3', tokenHash: 'hash-3', expiresAt: future() },
      ctx,
    );
    expect(result.outcome).toBe('REUSE_DETECTED');
    expect(family.status).toBe('COMPROMISED');
    expect(() => RefreshTokenFamily.throwIfReuse(result)).toThrow(RefreshTokenReuseError);
  });

  it('compromises the family on an unknown token hash', () => {
    const family = startFamily('hash-1');
    const result = family.consume(
      'not-in-family',
      { jti: 'jti-2', tokenHash: 'hash-2', expiresAt: future() },
      ctx,
    );
    expect(result.outcome).toBe('REUSE_DETECTED');
    expect(family.status).toBe('COMPROMISED');
  });

  it('revokes the whole family on logout', () => {
    const family = startFamily('hash-1');
    family.revoke('LOGOUT', ctx);
    expect(family.status).toBe('REVOKED');
  });
});

function startFamily(firstHash: string): RefreshTokenFamily {
  return RefreshTokenFamily.start(
    'family-1',
    { tenantId: 'tenant-1', userId: 'user-1', sessionId: 'session-1' },
    { jti: 'jti-1', tokenHash: firstHash, expiresAt: future() },
  );
}

function future(): Date {
  return new Date(Date.now() + 60_000);
}
