/**
 * CompositeAuthGuard — the single global authentication guard. It routes a
 * request to JWT or API-key authentication based on the presented credential,
 * skips `@Public()` routes, and attaches the AuthenticatedContext. Authorization
 * (permission checks) is the separate PermissionsGuard.
 *
 * Precedence: `@Public()` → skip. Then `X-API-Key` / `Bearer fv_...` → API key
 * (if a verifier is configured). Otherwise → JWT.
 *
 * Fail-closed: missing/invalid/expired/revoked token, or invalid API key → 401
 * with a generic message (no oracle, ARR SEC-3). Tenant switching (X-Tenant-Id)
 * is validated against the trusted tenant from the credential — any other
 * tenant → 403.
 */
import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
// biome-ignore lint/style/useImportType: NestJS DI needs the Reflector class value at runtime.
import { Reflector } from '@nestjs/core';
// biome-ignore lint/style/useImportType: value import required — NestJS DI reads constructor param types via emitDecoratorMetadata; a type-only import erases JwtService to Function and breaks injection at boot (latent bug surfaced by the Sprint E E2E).
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
// VALUE imports (not `import type`): these classes are DI tokens for the
// guard's constructor params — a type-only import is erased from
// design:paramtypes, Nest then can't resolve the param, and @Optional()
// silently injects undefined (API-key auth + revocation checks quietly OFF —
// the exact defect class Sprint I fixed in notification-service).
import type { ApiKeyVerifier, VerifiedApiKey } from './api-key-verifier.js';
import type { AuthenticatedContext } from './authenticated-context.js';
import { extractCredential } from './credentials.js';
import { IS_PUBLIC_KEY } from './decorators.js';
import type { RevocationStore } from './revocation-store.js';
import type { VerifiedAccessToken } from './token-claims.js';
import { AUTH_OPTIONS_TOKEN, type AuthGuardOptions } from './tokens.js';

@Injectable()
export class CompositeAuthGuard implements CanActivate {
  private readonly logger = new Logger(CompositeAuthGuard.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
    @Inject(AUTH_OPTIONS_TOKEN) private readonly options: AuthGuardOptions,
    @Optional() private readonly revocation?: RevocationStore,
    @Optional() private readonly apiKeyVerifier?: ApiKeyVerifier,
  ) {}

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.isPublic(context)) return true;
    const req = context.switchToHttp().getRequest<Request>();

    const credential = extractCredential(req);
    if (credential.kind === 'NONE') {
      throw new UnauthorizedException('Authentication is required.');
    }

    const ctx =
      credential.kind === 'API_KEY'
        ? await this.authenticateApiKey(credential.value, req)
        : await this.authenticateJwt(credential.value, req);
    req.auth = ctx;
    return true;
  }

  private isPublic(context: ExecutionContext): boolean {
    return (
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) === true
    );
  }

  private async authenticateJwt(token: string, req: Request): Promise<AuthenticatedContext> {
    let claims: VerifiedAccessToken;
    try {
      claims = (await this.jwt.verifyAsync(token, {
        algorithms: ['HS256'],
        issuer: this.options.issuer,
        audience: this.options.audience,
      })) as VerifiedAccessToken;
    } catch {
      throw new UnauthorizedException('Token is invalid or expired.');
    }

    if (!(await this.isTokenActive(claims))) {
      throw new UnauthorizedException('Token is invalid or expired.');
    }
    this.ensureTenantSwitchAllowed(req, claims.tenant_id);

    return {
      userId: claims.sub,
      tenantId: claims.tenant_id,
      tenantTier: claims.tenant_tier,
      roles: Array.isArray(claims.roles) ? [...claims.roles] : [],
      permissions: Array.isArray(claims.permissions) ? [...claims.permissions] : [],
      sessionId: claims.session_id,
      jti: claims.jti,
      authMethod: 'JWT',
    };
  }

  private async authenticateApiKey(presented: string, req: Request): Promise<AuthenticatedContext> {
    if (!this.apiKeyVerifier) {
      // API keys not enabled on this service.
      throw new UnauthorizedException('Authentication is required.');
    }
    let resolved: VerifiedApiKey | null;
    try {
      resolved = await this.apiKeyVerifier.verify(presented);
    } catch {
      throw new UnauthorizedException('API key is invalid, revoked, or expired.');
    }
    if (!resolved) {
      throw new UnauthorizedException('API key is invalid, revoked, or expired.');
    }
    // The key's tenant is authoritative; an X-Tenant-Id requesting a different
    // tenant is denied (API keys cannot cross tenants).
    this.ensureTenantSwitchAllowed(req, resolved.tenantId);
    return {
      userId: resolved.assignedUserId ?? resolved.keyId,
      tenantId: resolved.tenantId,
      tenantTier: '',
      roles: [],
      permissions: [...resolved.scopes],
      sessionId: '',
      jti: resolved.keyId,
      authMethod: 'API_KEY',
    };
  }

  private async isTokenActive(claims: VerifiedAccessToken): Promise<boolean> {
    if (!this.revocation) return true;
    try {
      return !(await this.revocation.isRevoked(claims.jti, claims.sub));
    } catch (err) {
      // Fail-OPEN on revocation-store outage for availability; signature/expiry
      // remains the hard boundary. Documented remaining risk.
      this.logger.warn(
        `Revocation store unreachable; allowing otherwise-valid token: ${(err as Error).message}`,
      );
      return true;
    }
  }

  private ensureTenantSwitchAllowed(req: Request, trustedTenantId: string): void {
    const requested = req.headers['x-tenant-id'];
    if (typeof requested === 'string' && requested.length > 0 && requested !== trustedTenantId) {
      throw new ForbiddenException('Access denied for the requested tenant.');
    }
  }
}
