/**
 * Refresh-token use-case — rotates an opaque refresh token, detecting reuse.
 * On reuse (AUTH-BR-08) the entire family is compromised and revoked, and a
 * `revocation:user:<uid>` flag is set so all access tokens die within 60s.
 */
import { Injectable } from '@nestjs/common';
import { RefreshTokenReuseError, TokenInvalidError } from '../../domain/index.js';
import type { RevocationStore } from '../../infrastructure/cache/session-store.js';
import type { AuthRepository } from '../../infrastructure/persistence/auth.repository.js';
import type { RoleRepository } from '../../infrastructure/persistence/role.repository.js';
import type { TenantRepository } from '../../infrastructure/persistence/tenant.repository.js';
import type { UserRepository } from '../../infrastructure/persistence/user.repository.js';
import type { TokenService } from '../../infrastructure/services/token-service.js';
import { buildEventContext } from '../shared/context.js';

export interface RefreshInput {
  readonly refreshToken: string;
  readonly tenantId: string;
  readonly correlationId?: string;
}

export interface RefreshResult {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresIn: number;
}

export interface RefreshConfig {
  readonly accessTtlSeconds: number;
}

@Injectable()
export class RefreshTokenUseCase {
  constructor(
    private readonly auth: AuthRepository,
    private readonly users: UserRepository,
    private readonly tenants: TenantRepository,
    private readonly tokens: TokenService,
    private readonly revocation: RevocationStore,
    private readonly roles: RoleRepository,
    private readonly config: RefreshConfig,
  ) {}

  public async execute(input: RefreshInput): Promise<RefreshResult> {
    const presented = this.tokens.parseRefresh(input.refreshToken);
    if (!presented) throw new TokenInvalidError();
    const presentedHash = this.tokens.hashRefresh(input.refreshToken);

    const family = await this.auth.findFamilyByTokenHash(presentedHash);
    if (!family) throw new TokenInvalidError();

    const ctx = buildEventContext(family.tenantId, 'refresh_token_family', input.correlationId);
    const newIssued = await this.tokens.issuePair(
      await this.claimsFor(family.userId, family.tenantId, family.sessionId),
      family.sessionId,
    );

    const result = family.consume(
      presentedHash,
      {
        jti: newIssued.refreshJti,
        tokenHash: newIssued.refreshTokenHash,
        expiresAt: newIssued.refreshExpiresAt,
      },
      ctx,
    );

    if (result.outcome === 'REUSE_DETECTED') {
      // Revoke everything for the user immediately.
      await this.auth.saveFamily(family, ctx);
      await this.revocation.revokeUser(family.userId, this.config.accessTtlSeconds);
      throw new RefreshTokenReuseError();
    }

    await this.auth.saveFamily(family, ctx);
    return {
      accessToken: newIssued.accessToken,
      refreshToken: newIssued.refreshToken,
      expiresIn: this.config.accessTtlSeconds,
    };
  }

  private async claimsFor(userId: string, tenantId: string, sessionId: string) {
    const user = await this.users.findById(tenantId, userId);
    const tenant = await this.tenants.findById(tenantId);
    if (!user || !tenant) throw new TokenInvalidError();
    // Re-resolve permissions on refresh so a rotated token reflects the latest
    // role grants (Sprint B).
    const [permissions, roleNames] = await Promise.all([
      this.roles.permissionsForUser(tenantId, userId),
      this.roles.namesForUser(tenantId, userId),
    ]);
    return {
      sub: user.id as string,
      tenant_id: tenantId,
      tenant_tier: tenant.tier,
      roles: roleNames,
      permissions,
      scope: 'openid offline_access',
      aal: 1,
      auth_time: Math.floor(Date.now() / 1000),
      session_id: sessionId,
    };
  }
}
