import { describe, expect, it } from '@jest/globals';
import { UnauthorizedException } from '@nestjs/common';
import { JwtAuthGuard } from '../jwt-auth.guard.js';
import type { TokenVerifier, VerifiedToken } from '../token-verifier.port.js';

/**
 * JwtAuthGuard (Sprint 1 requirement 1): unauthenticated requests are rejected
 * with 401; an invalid/expired token is rejected with 401 (generic message, no
 * oracle); a valid token attaches a Principal whose tenantId comes from the
 * verified claim — never from the request.
 */
function mkContext(headers: Record<string, string | undefined> = {}) {
  const req: Record<string, unknown> = { headers };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as never;
}

function fakeVerifier(claim: Partial<VerifiedToken> | null): TokenVerifier {
  return {
    verifyAccess: async () => {
      if (claim === null) throw new Error('bad token');
      return {
        sub: 'user-1',
        tenant_id: '11111111-1111-1111-1111-111111111111',
        tenant_tier: 'STANDARD',
        roles: ['tenant-admin'],
        scope: 'openid',
        aal: 1,
        session_id: 'sess-1',
        auth_time: 0,
        jti: 'jti-1',
        ...claim,
      } as VerifiedToken;
    },
  };
}

describe('JwtAuthGuard', () => {
  it('rejects a missing Authorization header (401)', async () => {
    const guard = new JwtAuthGuard({ verifier: fakeVerifier({}) });
    await expect(guard.canActivate(mkContext({}))).rejects.toBeInstanceOf(UnauthorizedException);
  });
  it('rejects a non-Bearer header (401)', async () => {
    const guard = new JwtAuthGuard({ verifier: fakeVerifier({}) });
    await expect(
      guard.canActivate(mkContext({ authorization: 'Basic abc' })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
  it('rejects an invalid token (401, generic message)', async () => {
    const guard = new JwtAuthGuard({ verifier: fakeVerifier(null) });
    await expect(
      guard.canActivate(mkContext({ authorization: 'Bearer bad' })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
  it('attaches a Principal with tenantId from the verified claim', async () => {
    const req: Record<string, unknown> = {
      headers: { authorization: 'Bearer good' },
    };
    const guard = new JwtAuthGuard({ verifier: fakeVerifier({}) });
    const ok = await guard.canActivate({
      switchToHttp: () => ({ getRequest: () => req }),
    } as never);
    expect(ok).toBe(true);
    const principal = req.principal as { tenantId: string; userId: string; authMethod: string };
    expect(principal).toBeDefined();
    expect(principal.tenantId).toBe('11111111-1111-1111-1111-111111111111');
    expect(principal.userId).toBe('user-1');
    expect(principal.authMethod).toBe('JWT');
  });
  it('honors a revoked token (401) when a RevocationChecker is wired', async () => {
    const guard = new JwtAuthGuard({
      verifier: fakeVerifier({}),
      revocation: { isRevoked: async () => true },
    });
    await expect(
      guard.canActivate(mkContext({ authorization: 'Bearer good' })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
  it('resolves permissions via the PermissionResolver when wired', async () => {
    const req: Record<string, unknown> = {
      headers: { authorization: 'Bearer good' },
    };
    const guard = new JwtAuthGuard({
      verifier: fakeVerifier({}),
      permissions: { permissionsForUser: async () => ['iam.user.read'] },
    });
    await guard.canActivate({
      switchToHttp: () => ({ getRequest: () => req }),
    } as never);
    const principal = req.principal as { permissions: readonly string[] };
    expect(principal.permissions).toContain('iam.user.read');
  });
});
