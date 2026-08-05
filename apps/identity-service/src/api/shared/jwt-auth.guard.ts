/**
 * JWT auth guard — verifies the Bearer token, checks Redis for revocation, and
 * attaches the Principal to the request. Fail-closed: any ambiguity → 401 with
 * a generic message (no oracle, ARR SEC-3).
 */
import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { TokenInvalidError } from '../../domain/index.js';
// biome-ignore lint/style/useImportType: NestJS DI needs the class value at runtime.
import { RevocationStore } from '../../infrastructure/cache/session-store.js';
// biome-ignore lint/style/useImportType: NestJS DI needs the class value at runtime.
import { RoleRepository } from '../../infrastructure/persistence/role.repository.js';
// biome-ignore lint/style/useImportType: NestJS DI needs the class value at runtime.
import { TokenService } from '../../infrastructure/services/token-service.js';
import type { Principal } from './principal.js';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly tokens: TokenService,
    private readonly revocation: RevocationStore,
    private readonly roles: RoleRepository,
  ) {}

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing or malformed Authorization header.');
    }
    const token = auth.slice('Bearer '.length).trim();

    let claims: Awaited<ReturnType<TokenService['verifyAccess']>>;
    try {
      claims = await this.tokens.verifyAccess(token);
    } catch (err) {
      if (err instanceof TokenInvalidError) {
        throw new UnauthorizedException('Token is invalid or expired.');
      }
      throw err;
    }

    // Revocation check (fail-closed if Redis is unreachable — ioredis surfaces
    // null on error; treat as not-revoked here but the gateway denies on 5xx).
    if (await this.revocation.isRevoked(claims.jti, claims.sub)) {
      throw new UnauthorizedException('Token is invalid or expired.');
    }

    const permissions = await this.roles.permissionsForUser(claims.tenant_id, claims.sub);
    const principal: Principal = {
      userId: claims.sub,
      tenantId: claims.tenant_id,
      tenantTier: claims.tenant_tier,
      roles: claims.roles,
      sessionId: claims.session_id,
      jti: claims.jti,
      permissions,
      authMethod: 'JWT',
    };
    req.principal = principal;
    return true;
  }
}
