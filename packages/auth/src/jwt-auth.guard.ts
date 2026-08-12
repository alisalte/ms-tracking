/**
 * JwtAuthGuard — verifies the Bearer token via the injected `TokenVerifier`,
 * optionally checks revocation, optionally resolves permissions, and attaches
 * the Principal to the request. Fail-closed: any ambiguity → 401 with a generic
 * message (no oracle, ARR SEC-3).
 *
 * This guard is generic over its collaborators (ports). The identity-service
 * wires the full set (TokenService + RevocationStore + RoleRepository); the four
 * non-identity services wire TokenVerifier + (optionally) a permission resolver
 * and no revocation checker.
 */
import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import type { Principal } from './principal.js';
import type {
  PermissionResolver,
  RevocationChecker,
  TokenVerifier,
} from './token-verifier.port.js';

export interface JwtAuthGuardDeps {
  readonly verifier: TokenVerifier;
  readonly revocation?: RevocationChecker;
  readonly permissions?: PermissionResolver;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly deps: JwtAuthGuardDeps) {}

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing or malformed Authorization header.');
    }
    const token = auth.slice('Bearer '.length).trim();

    let claims: Awaited<ReturnType<TokenVerifier['verifyAccess']>>;
    try {
      claims = await this.deps.verifier.verifyAccess(token);
    } catch {
      // Generic message — never disclose WHY the token failed (no oracle).
      throw new UnauthorizedException('Token is invalid or expired.');
    }

    // Revocation check is optional; when wired, fail-closed on a revoked jti.
    if (this.deps.revocation) {
      if (await this.deps.revocation.isRevoked(claims.jti, claims.sub)) {
        throw new UnauthorizedException('Token is invalid or expired.');
      }
    }

    // Permissions are resolved live when a permission resolver is wired;
    // otherwise the principal carries an empty set (authentication-only).
    const permissions = this.deps.permissions
      ? await this.deps.permissions.permissionsForUser(claims.tenant_id, claims.sub)
      : [];

    const principal: Principal = {
      userId: claims.sub,
      tenantId: claims.tenant_id,
      tenantTier: claims.tenant_tier,
      roles: claims.roles,
      sessionId: claims.session_id,
      jti: claims.jti,
      exp: claims.exp,
      permissions,
      authMethod: 'JWT',
    };
    req.principal = principal;
    return true;
  }
}
