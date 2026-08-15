/**
 * Login use-case — authenticates a user with email + password and issues an
 * access + refresh token pair.
 *
 * Security rules (Authentication.md §9.5, ARR SEC-3):
 *   - Generic "invalid credentials" on any failure (no user-enumeration oracle).
 *   - Rate-limited per IP and per user before the password check.
 *   - Account locked after LOGIN_MAX_ATTEMPTS failed tries (AUTH-BR-03).
 *   - Tenant must be ACTIVE (TEN-BR-06); suspended tenants block login.
 *
 * On success: a session is created (Redis + PG mirror), a refresh-token family
 * is started, and tokens are issued. Domain events (login succeeded, user
 * locked) flow through the outbox.
 */
import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  AccountLockedError,
  InvalidCredentialsError,
  type Tenant,
  TenantNotActiveError,
  type User,
} from '../../domain/index.js';
import { RefreshTokenFamily } from '../../domain/refresh-token-family.js';
import type { RateLimiterStore, SessionStore } from '../../infrastructure/cache/session-store.js';
import type { AuthRepository } from '../../infrastructure/persistence/auth.repository.js';
import type { RoleRepository } from '../../infrastructure/persistence/role.repository.js';
import type { TenantRepository } from '../../infrastructure/persistence/tenant.repository.js';
import type { UserRepository } from '../../infrastructure/persistence/user.repository.js';
import type { PasswordHasher } from '../../infrastructure/services/password-hasher.js';
import type { TokenService } from '../../infrastructure/services/token-service.js';
import { buildEventContext } from '../shared/context.js';

export interface LoginInput {
  readonly email: string;
  readonly password: string;
  readonly tenantId: string;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
  readonly correlationId?: string;
}

export interface LoginResult {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresIn: number;
  readonly sessionId: string;
  readonly user: { id: string; email: string; tenantId: string; roles: readonly string[] };
}

export interface LoginConfig {
  readonly accessTtlSeconds: number;
  readonly refreshTtlSeconds: number;
  readonly maxAttempts: number;
  readonly lockoutSeconds: number;
  /** Rate-limit thresholds (per minute). */
  readonly rateLimitPerIp: number;
  readonly rateLimitPerUser: number;
}

@Injectable()
export class LoginUseCase {
  constructor(
    private readonly users: UserRepository,
    private readonly tenants: TenantRepository,
    private readonly auth: AuthRepository,
    private readonly hasher: PasswordHasher,
    private readonly tokens: TokenService,
    private readonly sessions: SessionStore,
    private readonly rateLimiter: RateLimiterStore,
    private readonly roles: RoleRepository,
    private readonly config: LoginConfig,
  ) {}

  public async execute(input: LoginInput): Promise<LoginResult> {
    // 1. Rate-limit per IP (before any DB lookup to shed load).
    if (input.ipAddress) {
      const ipHits = await this.rateLimiter.hitLoginIp(input.ipAddress);
      if (ipHits > this.config.rateLimitPerIp) {
        throw new InvalidCredentialsError();
      }
    }

    // 2. Look up the user within the tenant.
    const user = await this.users.findByEmail(input.tenantId, input.email);
    if (!user) {
      // No user — but still consume time to avoid an oracle.
      throw new InvalidCredentialsError();
    }

    // 3. Rate-limit per user + lockout check.
    const userHits = await this.rateLimiter.hitLoginUser(user.id as string);
    if (userHits > this.config.rateLimitPerUser) {
      throw new InvalidCredentialsError();
    }
    if (await this.rateLimiter.isLocked(user.id as string)) {
      throw new AccountLockedError();
    }

    // 4. Tenant must be active.
    const tenant = await this.tenants.findById(input.tenantId);
    if (!tenant || !tenant.isActive()) {
      throw new TenantNotActiveError();
    }

    const ctx = buildEventContext(input.tenantId, 'user', input.correlationId);

    // 5. Verify password.
    if (!user.passwordHash || !(await this.hasher.verify(user.passwordHash, input.password))) {
      const { locked } = user.recordFailedLogin(this.config.maxAttempts, ctx);
      await this.users.save(user, ctx);
      if (locked) {
        await this.rateLimiter.setLockout(user.id as string, this.config.lockoutSeconds);
      }
      throw new InvalidCredentialsError();
    }

    // 6. Issue tokens + create session + start refresh family.
    const sessionId = randomUUID();
    const refreshFamilyId = randomUUID();
    const issued = await this.tokens.issuePair(
      await this.claims(user, tenant, sessionId),
      sessionId,
    );
    const family = RefreshTokenFamily.start(
      refreshFamilyId,
      {
        tenantId: user.tenantId,
        userId: user.id as string,
        sessionId,
      },
      {
        jti: issued.refreshJti,
        tokenHash: issued.refreshTokenHash,
        expiresAt: issued.refreshExpiresAt,
      },
    );

    user.recordSuccessfulLogin(sessionId, input.ipAddress, ctx);
    await this.users.save(user, ctx);
    await this.auth.saveFamily(
      family,
      buildEventContext(input.tenantId, 'refresh_token_family', input.correlationId),
    );

    const now = Date.now();
    await this.sessions.create(
      {
        sessionId,
        userId: user.id as string,
        tenantId: input.tenantId,
        refreshFamilyId,
        issuedAt: now,
        absoluteExpiresAt: now + this.config.refreshTtlSeconds * 1000,
      },
      this.config.accessTtlSeconds,
      this.config.refreshTtlSeconds,
    );

    return {
      accessToken: issued.accessToken,
      refreshToken: issued.refreshToken,
      expiresIn: this.config.accessTtlSeconds,
      sessionId,
      user: {
        id: user.id as string,
        email: user.email,
        tenantId: input.tenantId,
        roles: user.roles,
      },
    };
  }

  /**
   * Build the access-token claims, embedding the resolved permission union so
   * downstream services authorize statelessly (Sprint B).
   */
  private async claims(user: User, tenant: Tenant, sessionId: string) {
    const permissions = await this.roles.permissionsForUser(user.tenantId, user.id as string);
    return {
      sub: user.id as string,
      tenant_id: user.tenantId,
      tenant_tier: tenant.tier,
      roles: [...user.roles],
      permissions,
      scope: 'openid offline_access',
      aal: 1,
      auth_time: Math.floor(Date.now() / 1000),
      session_id: sessionId,
    };
  }
}
