/**
 * Refresh-token family — the reuse-detection unit (AUTH-BR-08).
 *
 * A family is created at login and dies with its session. At most one
 * unconsumed refresh token exists in an ACTIVE family. If a *consumed* token is
 * presented again, the entire family is marked COMPROMISED and every token in
 * it is revoked — the canonical theft signal.
 *
 * (docs/modules/Authentication.md §4.3, §6.7)
 */
import { AggregateRoot, type Brand } from '@fleetvision/shared-kernel';
import { RefreshTokenReuseError } from './errors.js';
import { AuthTokenRevokedEvent, type EventContext } from './events.js';

export type FamilyStatus = 'ACTIVE' | 'COMPROMISED' | 'EXPIRED' | 'REVOKED';

export interface RefreshTokenRecord {
  readonly jti: string;
  readonly tokenHash: string;
  readonly expiresAt: Date;
  consumedAt: Date | null;
  revokedAt: Date | null;
  revokedReason: string | null;
}

export interface RefreshTokenFamilyProps {
  readonly tenantId: string;
  readonly userId: string;
  readonly sessionId: string;
  readonly status: FamilyStatus;
  /** Tokens belonging to this family, keyed by token hash. */
  readonly tokens: Map<string, RefreshTokenRecord>;
}

/**
 * Decision returned when consuming a refresh token — tells the caller whether
 * to mint a new token or to revoke everything.
 */
export interface ConsumeRefreshResult {
  readonly outcome: 'ROTATED' | 'REUSE_DETECTED';
  readonly newJti: string | null;
  readonly newTokenHash: string | null;
}

export class RefreshTokenFamily extends AggregateRoot<Brand<string, 'RefreshFamilyId'>> {
  private readonly props: RefreshTokenFamilyProps;

  private constructor(id: string, version: number, props: RefreshTokenFamilyProps) {
    super(id as Brand<string, 'RefreshFamilyId'>, version);
    this.props = props;
  }

  /** Start a new family at login; returns the first token record. */
  public static start(
    id: string,
    init: { tenantId: string; userId: string; sessionId: string },
    firstToken: { jti: string; tokenHash: string; expiresAt: Date },
  ): RefreshTokenFamily {
    const tokens = new Map<string, RefreshTokenRecord>();
    tokens.set(firstToken.tokenHash, {
      jti: firstToken.jti,
      tokenHash: firstToken.tokenHash,
      expiresAt: firstToken.expiresAt,
      consumedAt: null,
      revokedAt: null,
      revokedReason: null,
    });
    return new RefreshTokenFamily(id, 0, {
      tenantId: init.tenantId,
      userId: init.userId,
      sessionId: init.sessionId,
      status: 'ACTIVE',
      tokens,
    });
  }

  public static rehydrate(
    id: string,
    version: number,
    props: RefreshTokenFamilyProps,
  ): RefreshTokenFamily {
    // Defensive copy of the tokens map.
    const tokens = new Map<string, RefreshTokenRecord>();
    for (const [k, v] of props.tokens) {
      tokens.set(k, { ...v });
    }
    return new RefreshTokenFamily(id, version, { ...props, tokens });
  }

  public get status(): FamilyStatus {
    return this.props.status;
  }
  public get sessionId(): string {
    return this.props.sessionId;
  }
  public get userId(): string {
    return this.props.userId;
  }
  public get tenantId(): string {
    return this.props.tenantId;
  }
  /** All token records in the family (for persistence). */
  public get tokenRecords(): readonly RefreshTokenRecord[] {
    return [...this.props.tokens.values()];
  }
  public get tokenHashes(): readonly string[] {
    return [...this.props.tokens.keys()];
  }

  /**
   * Consume a presented refresh token. If the token was already consumed, the
   * family is compromised and the caller must revoke everything; otherwise the
   * old token is marked consumed and a new one is recorded for rotation.
   */
  public consume(
    presentedHash: string,
    newToken: { jti: string; tokenHash: string; expiresAt: Date },
    ctx: EventContext,
  ): ConsumeRefreshResult {
    const record = this.props.tokens.get(presentedHash);
    if (!record) {
      // Unknown token presented against this family — treat as a theft signal
      // and compromise the family (fail-closed, AUTH-BR-08).
      this.compromise(ctx);
      return { outcome: 'REUSE_DETECTED', newJti: null, newTokenHash: null };
    }
    if (record.consumedAt !== null || record.revokedAt !== null) {
      // Reuse detected: revoke the whole family.
      this.compromise(ctx);
      return { outcome: 'REUSE_DETECTED', newJti: null, newTokenHash: null };
    }
    // Legitimate rotation.
    record.consumedAt = new Date();
    this.props.tokens.set(newToken.tokenHash, {
      jti: newToken.jti,
      tokenHash: newToken.tokenHash,
      expiresAt: newToken.expiresAt,
      consumedAt: null,
      revokedAt: null,
      revokedReason: null,
    });
    return { outcome: 'ROTATED', newJti: newToken.jti, newTokenHash: newToken.tokenHash };
  }

  /** Mark the whole family compromised — revoke all tokens. */
  public compromise(ctx: EventContext): void {
    (this.props as { status: FamilyStatus }).status = 'COMPROMISED';
    const now = new Date();
    for (const record of this.props.tokens.values()) {
      record.revokedAt = now;
      record.revokedReason = 'REFRESH_REUSE';
    }
    this.raise(new AuthTokenRevokedEvent(this.eventContext(ctx), 'REFRESH_REUSE'));
  }

  /** Revoke the family (logout / logout-all). */
  public revoke(reason: string, ctx: EventContext): void {
    (this.props as { status: FamilyStatus }).status = 'REVOKED';
    const now = new Date();
    for (const record of this.props.tokens.values()) {
      record.revokedAt = now;
      record.revokedReason = reason;
    }
    this.raise(new AuthTokenRevokedEvent(this.eventContext(ctx), reason));
  }

  /** Throw if reuse was detected, so callers surface a 401 to the client. */
  public static throwIfReuse(result: ConsumeRefreshResult): void {
    if (result.outcome === 'REUSE_DETECTED') {
      throw new RefreshTokenReuseError();
    }
  }

  private eventContext(ctx: EventContext) {
    return {
      tenant_id: ctx.tenantId,
      correlation_id: ctx.correlationId,
      aggregate_id: this.id as string,
      aggregate_type: ctx.aggregateType,
      aggregate_version: this.version,
    };
  }
}
