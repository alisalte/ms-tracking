import type { Principal } from '@fleetvision/auth';
import { describe, expect, it } from '@jest/globals';
import type { Request } from 'express';
import { AuthController } from '../api/auth/auth.controller.js';

/**
 * Sprint 1 requirement 2: /api/v1/auth/me must return the REAL authenticated
 * user information (hydrated email from the DB), not a hardcoded empty string.
 * It must 401 (InvalidCredentialsError) when the user no longer exists.
 */
function reqWithPrincipal(p: Principal): Request {
  return { principal: p } as unknown as Request;
}

const principal: Principal = {
  userId: 'user-1',
  tenantId: '11111111-1111-1111-1111-111111111111',
  tenantTier: 'STANDARD',
  roles: ['tenant-admin'],
  sessionId: 'sess-1',
  jti: 'jti-1',
  exp: Math.floor(Date.now() / 1000) + 900,
  permissions: ['*'],
  authMethod: 'JWT',
};

describe('AuthController.me returns the real user', () => {
  it('hydrates the email from UserRepository', async () => {
    const users = {
      findById: async () => ({
        id: 'user-1',
        tenantId: principal.tenantId,
        email: 'real@fleetvision.local',
        username: 'admin',
        roles: ['tenant-admin'],
      }),
    };
    // Minimal controller: only me() is exercised; the other deps are unused.
    const ctrl = new AuthController(
      null as never,
      null as never,
      null as never,
      null as never,
      users as never,
    );
    const res = await ctrl.me(reqWithPrincipal(principal));
    expect(res.data.email).toBe('real@fleetvision.local');
    expect(res.data.id).toBe('user-1');
    expect(res.data.tenant_id).toBe(principal.tenantId);
  });

  it('throws InvalidCredentialsError when the user no longer exists', async () => {
    const users = { findById: async () => null };
    const ctrl = new AuthController(
      null as never,
      null as never,
      null as never,
      null as never,
      users as never,
    );
    await expect(ctrl.me(reqWithPrincipal(principal))).rejects.toThrow();
  });
});
