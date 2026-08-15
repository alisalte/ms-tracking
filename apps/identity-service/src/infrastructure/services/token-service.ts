/**
 * Token service — issues and verifies JWTs (HS256 for the MVP) and mints opaque
 * refresh tokens. Claims are flat (Authentication.md §6.1, 16_Public-API-Platform
 * §7.3): tenant_id, tenant_tier, roles, permissions, scope, aal, session_id,
 * auth_time. Sprint B embeds `permissions` so downstream services authorize
 * statelessly without a per-request DB read.
 *
 * HS256 migrates to RS256 + JWKS (Vault Transit) in a later sprint; the public
 * surface here (`signAccess`, `verifyAccess`, `signRefresh`, `hashRefresh`)
 * stays stable so the application layer is agnostic to the algorithm.
 */
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { JwtService } from '@nestjs/jwt';
// Sprint B: the claims contract is shared so every service reads the same shape.
export type { AccessTokenClaims } from '@fleetvision/auth';
import type { AccessTokenClaims } from '@fleetvision/auth';
import { TokenInvalidError } from '../../domain/index.js';

export interface TokenServiceConfig {
  readonly issuer: string;
  readonly audience: string;
  readonly accessTtlSeconds: number;
  readonly refreshTtlSeconds: number;
}

export interface IssuedTokens {
  readonly accessToken: string;
  readonly accessJti: string;
  readonly accessExpiresAt: Date;
  readonly refreshToken: string;
  readonly refreshJti: string;
  readonly refreshExpiresAt: Date;
  /** Argon2-safe SHA-256 hash of the refresh secret (store, not the plaintext). */
  readonly refreshTokenHash: string;
}

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: TokenServiceConfig,
  ) {}

  /** Issue an access + refresh token pair for an authenticated principal. */
  public async issuePair(claims: AccessTokenClaims, sessionId: string): Promise<IssuedTokens> {
    const now = Date.now();
    const accessJti = randomUUID();
    const accessExpiresAt = new Date(now + this.config.accessTtlSeconds * 1000);
    const accessToken = await this.jwt.signAsync(
      {
        ...claims,
        iat: Math.floor(now / 1000),
        nbf: Math.floor(now / 1000),
        exp: Math.floor(accessExpiresAt.getTime() / 1000),
        jti: accessJti,
        session_id: sessionId,
      },
      // iss/aud come from these options; jsonwebtoken rejects payload `iss`/`aud`
      // when the same option is also set, so don't duplicate them in the payload.
      { algorithm: 'HS256', issuer: this.config.issuer, audience: this.config.audience },
    );

    // Refresh token is opaque (not a JWT): random 256-bit secret + a jti header.
    const refreshJti = randomUUID();
    const refreshExpiresAt = new Date(now + this.config.refreshTtlSeconds * 1000);
    const refreshSecret = randomBytes(32).toString('base64url');
    const refreshToken = `v1.${refreshJti}.${refreshSecret}`;
    const refreshTokenHash = this.hashRefresh(refreshToken);

    return {
      accessToken,
      accessJti,
      accessExpiresAt,
      refreshToken,
      refreshJti,
      refreshExpiresAt,
      refreshTokenHash,
    };
  }

  /** Verify an access token and return its claims, or throw TokenInvalidError. */
  public async verifyAccess(token: string): Promise<AccessTokenClaims & { jti: string }> {
    try {
      const payload = await this.jwt.verifyAsync(token, {
        algorithms: ['HS256'],
        issuer: this.config.issuer,
        audience: this.config.audience,
      });
      return payload as AccessTokenClaims & { jti: string };
    } catch {
      throw new TokenInvalidError();
    }
  }

  /** SHA-256 hash of the full refresh-token string (constant-time compare). */
  public hashRefresh(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  /** Parse a refresh token into its (jti, secret) parts. */
  public parseRefresh(token: string): { jti: string; secret: string } | null {
    const parts = token.split('.');
    if (parts.length !== 3 || parts[0] !== 'v1' || !parts[1] || !parts[2]) return null;
    return { jti: parts[1], secret: parts[2] };
  }

  /** Constant-time equality for token hashes (defense-in-depth). */
  public static safeEqual(a: string, b: string): boolean {
    const ab = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ab.length !== bb.length) return false;
    return timingSafeEqual(ab, bb);
  }
}
