import { describe, expect, it } from '@jest/globals';
/**
 * Sprint B security test matrix — unit tests for the shared auth guards.
 * Covers: missing/invalid JWT → 401 (1,2); insufficient permission → throw /
 * correct permission → allow (4,5); tenant switch own→allow / other→403 (9,10);
 * @Public bypass; API key valid→allow / revoked→deny / cross-tenant→deny (16-18).
 *
 * Pattern mirrors the repo convention: construct the guard with stubbed deps and
 * feed a hand-built ExecutionContext (no guard tests existed before this sprint).
 */
import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import {
  type AuthenticatedContext,
  CompositeAuthGuard,
  IS_PUBLIC_KEY,
  PERMISSIONS_KEY,
  PermissionsGuard,
} from '../index.js';

const TENANT_A = '00000000-0000-0000-0000-000000000001';
const TENANT_B = '00000000-0000-0000-0000-000000000002';
const USER = '00000000-0000-0000-0000-00000000000a';

/** Minimal fake JwtService implementing only verifyAsync(). */
function fakeJwt(verifyImpl: (token: string) => unknown): never {
  return {
    verifyAsync: (t: string) => Promise.resolve(verifyImpl(t)),
  } as never;
}

function ctxFor(req: Request, handlerMeta: Record<string, unknown> = {}): ExecutionContext {
  const handler = function handler() {};
  const klass = class HandlerKlass {};
  if (handlerMeta[IS_PUBLIC_KEY] !== undefined) {
    SetMetadata(IS_PUBLIC_KEY, handlerMeta[IS_PUBLIC_KEY])(handler);
  }
  if (handlerMeta[PERMISSIONS_KEY] !== undefined) {
    SetMetadata(PERMISSIONS_KEY, handlerMeta[PERMISSIONS_KEY])(handler);
  }
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => handler,
    getClass: () => klass,
  } as unknown as ExecutionContext;
}

function makeReq(
  headers: Record<string, string | undefined> = {},
  auth?: AuthenticatedContext,
): Request {
  return { headers, auth } as unknown as Request;
}

function principal(overrides: Partial<AuthenticatedContext> = {}): AuthenticatedContext {
  return {
    userId: USER,
    tenantId: TENANT_A,
    tenantTier: '',
    roles: [],
    permissions: [],
    sessionId: '',
    jti: '',
    authMethod: 'JWT',
    ...overrides,
  };
}

describe('CompositeAuthGuard — authentication', () => {
  const reflector = new Reflector();
  const options = { issuer: 'fleetvision', audience: 'fleetvision' };

  it('1. missing Authorization → 401', async () => {
    const guard = new CompositeAuthGuard(
      fakeJwt(() => ({})),
      reflector,
      options,
    );
    await expect(guard.canActivate(ctxFor(makeReq()))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('2. invalid/expired JWT → 401', async () => {
    const jwt = fakeJwt(() => {
      throw new Error('jwt malformed');
    });
    const guard = new CompositeAuthGuard(jwt, reflector, options);
    const req = makeReq({ authorization: 'Bearer not.a.jwt' });
    await expect(guard.canActivate(ctxFor(req))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('3. valid JWT attaches AuthenticatedContext (incl. permissions)', async () => {
    const jwt = fakeJwt(() => ({
      sub: USER,
      tenant_id: TENANT_A,
      tenant_tier: 'STANDARD',
      roles: ['viewer'],
      permissions: ['tracking.read'],
      session_id: 's1',
      jti: 'j1',
    }));
    const guard = new CompositeAuthGuard(jwt, reflector, options);
    const req = makeReq({ authorization: 'Bearer good.jwt' });
    await expect(guard.canActivate(ctxFor(req))).resolves.toBe(true);
    expect(req.auth?.tenantId).toBe(TENANT_A);
    expect(req.auth?.permissions).toContain('tracking.read');
    expect(req.auth?.authMethod).toBe('JWT');
  });

  it('9. tenant switch to OWN tenant → allowed', async () => {
    const jwt = fakeJwt(() => ({
      sub: USER,
      tenant_id: TENANT_A,
      roles: [],
      permissions: [],
      session_id: 's1',
      jti: 'j1',
    }));
    const guard = new CompositeAuthGuard(jwt, reflector, options);
    const req = makeReq({ authorization: 'Bearer good.jwt', 'x-tenant-id': TENANT_A });
    await expect(guard.canActivate(ctxFor(req))).resolves.toBe(true);
  });

  it('10. tenant switch to ANOTHER tenant → 403', async () => {
    const jwt = fakeJwt(() => ({
      sub: USER,
      tenant_id: TENANT_A,
      roles: [],
      permissions: [],
      session_id: 's1',
      jti: 'j1',
    }));
    const guard = new CompositeAuthGuard(jwt, reflector, options);
    const req = makeReq({ authorization: 'Bearer good.jwt', 'x-tenant-id': TENANT_B });
    await expect(guard.canActivate(ctxFor(req))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('@Public route bypasses authentication', async () => {
    const jwt = fakeJwt(() => {
      throw new Error('should not be called');
    });
    const guard = new CompositeAuthGuard(jwt, reflector, options);
    const req = makeReq();
    await expect(guard.canActivate(ctxFor(req, { [IS_PUBLIC_KEY]: true }))).resolves.toBe(true);
  });
});

describe('PermissionsGuard — authorization', () => {
  const reflector = new Reflector();

  function guard(): CanActivate {
    return new PermissionsGuard(reflector);
  }

  it('4. authenticated but insufficient permission → throws', () => {
    const req = makeReq({}, principal({ permissions: ['maps.read'] }));
    expect(() =>
      guard().canActivate(ctxFor(req, { [PERMISSIONS_KEY]: ['tracking.read'] })),
    ).toThrow();
  });

  it('5. correct permission → allowed', () => {
    const req = makeReq({}, principal({ permissions: ['tracking.read'] }));
    expect(guard().canActivate(ctxFor(req, { [PERMISSIONS_KEY]: ['tracking.read'] }))).toBe(true);
  });

  it('wildcard permission satisfies any requirement', () => {
    const req = makeReq({}, principal({ permissions: ['*'], roles: ['tenant-admin'] }));
    expect(
      guard().canActivate(ctxFor(req, { [PERMISSIONS_KEY]: ['telemetry.gateway.manage'] })),
    ).toBe(true);
  });
});

describe('CompositeAuthGuard — API-key path', () => {
  const reflector = new Reflector();
  const options = { issuer: 'fleetvision', audience: 'fleetvision' };

  function fakeVerifier(
    resolver: (key: string) => {
      tenantId: string;
      scopes: readonly string[];
      keyId: string;
      assignedUserId: string | null;
    } | null,
  ): never {
    return { verify: (k: string) => Promise.resolve(resolver(k)) } as never;
  }

  it('16. valid API key (tenant A) → allowed, context scoped to key tenant', async () => {
    const guard = new CompositeAuthGuard(
      fakeJwt(() => ({})),
      reflector,
      options,
      undefined,
      fakeVerifier(() => ({
        tenantId: TENANT_A,
        scopes: ['tracking.read'],
        keyId: 'k1',
        assignedUserId: USER,
      })),
    );
    const req = makeReq({ authorization: 'Bearer fv_live_validkey' });
    await expect(guard.canActivate(ctxFor(req))).resolves.toBe(true);
    expect(req.auth?.tenantId).toBe(TENANT_A);
    expect(req.auth?.permissions).toContain('tracking.read');
    expect(req.auth?.authMethod).toBe('API_KEY');
  });

  it('17. revoked/invalid API key → 401', async () => {
    const guard = new CompositeAuthGuard(
      fakeJwt(() => ({})),
      reflector,
      options,
      undefined,
      fakeVerifier(() => null),
    );
    const req = makeReq({ authorization: 'Bearer fv_live_revoked' });
    await expect(guard.canActivate(ctxFor(req))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('18. API key scoped to tenant A cannot reach tenant B (x-tenant-id switch → 401)', async () => {
    const guard = new CompositeAuthGuard(
      fakeJwt(() => ({})),
      reflector,
      options,
      undefined,
      fakeVerifier(() => ({
        tenantId: TENANT_A,
        scopes: ['tracking.read'],
        keyId: 'k1',
        assignedUserId: null,
      })),
    );
    const req = makeReq({ authorization: 'Bearer fv_live_validkey', 'x-tenant-id': TENANT_B });
    // A cross-tenant switch is denied (403 here; the JWT path yields 403 too).
    await expect(guard.canActivate(ctxFor(req))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('API key with no verifier configured → 401', async () => {
    const guard = new CompositeAuthGuard(
      fakeJwt(() => ({})),
      reflector,
      options,
      undefined,
      undefined,
    );
    const req = makeReq({ authorization: 'Bearer fv_live_anykey' });
    await expect(guard.canActivate(ctxFor(req))).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
