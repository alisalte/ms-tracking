/**
 * Auth config schema — the JWT verification contract shared by every service.
 * Each service extends its own config with `authConfigSchema` so the same env
 * vars (JWT_SECRET/ISSUER/AUDIENCE) are validated identically everywhere and a
 * token issued by identity-service verifies in every downstream service.
 *
 * HS256 (shared symmetric secret) for the MVP; migrates to RS256 + JWKS later.
 * The **audience** is standardized platform-wide (`fleetvision`) so one token
 * is accepted by all internal services — defense-in-depth per-service audiences
 * are a future hardening (would require multi-audience issuance/verification).
 */
import { z } from 'zod';

export const authConfigSchema = z.object({
  /** HS256 HMAC secret (>= 32 chars). Generate with `openssl rand -hex 48`. */
  JWT_SECRET: z.string().min(32),
  /** Token issuer (`iss` claim). */
  JWT_ISSUER: z.string().min(1).default('fleetvision'),
  /**
   * Token audience (`aud` claim). Standardized platform-wide so all services
   * verify the same token. identity-service signs with this same value.
   */
  JWT_AUDIENCE: z.string().min(1).default('fleetvision'),
});

export type AuthConfig = z.infer<typeof authConfigSchema>;
