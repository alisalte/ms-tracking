import { JwtAuthGuard as JwtAuthGuardBase, type JwtAuthGuardDeps } from '@fleetvision/auth';
/**
 * identity-service JwtAuthGuard — wires the SHARED guard (from @fleetvision/auth)
 * with identity's real collaborators: TokenService (verifier), RevocationStore
 * (Redis revocation), and RoleRepository (live permission resolution).
 *
 * Additionally touches the durable PG session mirror (iam.auth_sessions) on each
 * successful authentication so last_seen_at stays current and the session status
 * is re-validated against the system of record (a revoked PG session is denied
 * even if the Redis revocation key is missing). The touch is best-effort: a DB
 * error does not break authentication (the short access-token TTL is the
 * fallback), but a session whose status is not ACTIVE denies the request.
 *
 * Fail-closed: any ambiguity → 401 with a generic message (no oracle, ARR SEC-3).
 */
import { type ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
// biome-ignore lint/style/useImportType: NestJS DI needs the class value at runtime.
import { RevocationStore } from '../../infrastructure/cache/session-store.js';
// biome-ignore lint/style/useImportType: NestJS DI needs the class value at runtime.
import { AuthRepository } from '../../infrastructure/persistence/auth.repository.js';
// biome-ignore lint/style/useImportType: NestJS DI needs the class value at runtime.
import { RoleRepository } from '../../infrastructure/persistence/role.repository.js';
// biome-ignore lint/style/useImportType: NestJS DI needs the class value at runtime.
import { TokenService } from '../../infrastructure/services/token-service.js';

@Injectable()
export class JwtAuthGuard extends JwtAuthGuardBase {
  constructor(
    tokens: TokenService,
    revocation: RevocationStore,
    roles: RoleRepository,
    private readonly auth: AuthRepository,
  ) {
    const deps: JwtAuthGuardDeps = {
      verifier: tokens,
      revocation,
      permissions: roles,
    };
    super(deps);
  }

  public override async canActivate(context: ExecutionContext): Promise<boolean> {
    const ok = await super.canActivate(context);
    if (!ok) return false;
    // Touch the durable session mirror + re-validate status. Best-effort: a DB
    // error is swallowed (don't break auth on a transient DB blip), but a session
    // whose status is not ACTIVE denies the request (fail-closed on revocation).
    const req = context.switchToHttp().getRequest();
    const principal = req.principal as { tenantId: string; sessionId: string } | undefined;
    if (principal) {
      try {
        const row = await this.auth.touchSession(principal.tenantId, principal.sessionId);
        if (row && row.status !== 'ACTIVE') {
          throw new UnauthorizedException('Token is invalid or expired.');
        }
      } catch (err) {
        // Re-throw the 401 from a non-ACTIVE session; swallow infra errors so a
        // transient DB blip does not deny an otherwise-valid token.
        if (err instanceof UnauthorizedException) throw err;
      }
    }
    return true;
  }
}
