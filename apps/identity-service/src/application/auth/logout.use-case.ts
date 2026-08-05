/**
 * Logout use-case — revokes the caller's session, its refresh family, and the
 * current access token's jti (so it dies immediately rather than at natural
 * expiry). `logout-all` additionally sets `revocation:user:<uid>`.
 */
import { Injectable } from '@nestjs/common';
import type { RevocationStore, SessionStore } from '../../infrastructure/cache/session-store.js';
import type { AuthRepository } from '../../infrastructure/persistence/auth.repository.js';
import { buildEventContext } from '../shared/context.js';

export interface LogoutInput {
  readonly tenantId: string;
  readonly userId: string;
  readonly sessionId: string;
  readonly accessJti: string;
  readonly accessTtlRemainingSeconds: number;
  readonly all: boolean;
  readonly correlationId?: string;
}

@Injectable()
export class LogoutUseCase {
  constructor(
    private readonly auth: AuthRepository,
    private readonly sessions: SessionStore,
    private readonly revocation: RevocationStore,
  ) {}

  public async execute(input: LogoutInput): Promise<void> {
    const ctx = buildEventContext(input.tenantId, 'auth_session', input.correlationId);
    void ctx;

    if (input.all) {
      const sessionIds = await this.sessions.revokeAllForUser(input.userId);
      await this.auth.revokeAllUserSessions(input.tenantId, input.userId, 'LOGOUT_ALL');
      await this.revocation.revokeUser(input.userId);
      void sessionIds;
    } else {
      await this.sessions.revoke(input.sessionId);
      await this.auth.revokeSession(input.tenantId, input.sessionId, 'LOGOUT');
    }
    // Kill the current access token immediately.
    await this.revocation.revokeToken(input.accessJti, input.accessTtlRemainingSeconds);
  }
}
