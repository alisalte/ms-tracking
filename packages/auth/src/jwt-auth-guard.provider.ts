/**
 * Provider helpers — concise wiring of a `JwtAuthGuard` from the injected
 * `TokenVerifier` plus optional `RevocationChecker` / `PermissionResolver`.
 *
 * The guard is provided under the JwtAuthGuard CLASS token so controllers can
 * apply it with `@UseGuards(JwtAuthGuard)` (NestJS resolves it via DI).
 *
 * Usage in a service module:
 *   providers: [jwtAuthGuardProvider()]
 * The identity-service does NOT use this (it constructs its own guard with the
 * real TokenService/RevocationStore/RoleRepository).
 */
import type { Provider } from '@nestjs/common';
import { JwtAuthGuard, type JwtAuthGuardDeps } from './jwt-auth.guard.js';
import type {
  PermissionResolver,
  RevocationChecker,
  TokenVerifier,
} from './token-verifier.port.js';
import { PERMISSION_RESOLVER, REVOCATION_CHECKER, TOKEN_VERIFIER } from './tokens.js';

/**
 * Build the JwtAuthGuard provider (registered under the JwtAuthGuard class token
 * so `@UseGuards(JwtAuthGuard)` resolves it). The optional collaborators are
 * read via their tokens if present, otherwise undefined (authentication-only).
 */
export function jwtAuthGuardProvider(): Provider {
  return {
    provide: JwtAuthGuard,
    inject: [
      TOKEN_VERIFIER,
      { token: REVOCATION_CHECKER, optional: true },
      { token: PERMISSION_RESOLVER, optional: true },
    ],
    useFactory: (
      verifier: TokenVerifier,
      revocation: RevocationChecker | undefined,
      permissions: PermissionResolver | undefined,
    ): JwtAuthGuard => {
      const deps: JwtAuthGuardDeps = { verifier, revocation, permissions };
      return new JwtAuthGuard(deps);
    },
  };
}
