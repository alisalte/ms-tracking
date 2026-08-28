/**
 * User aggregate — the identity record for a person within a tenant.
 *
 * Invariants (Identity-Access-Management.md §3.1):
 *   INV-IAM-01: email unique within tenant (enforced by a DB unique index).
 *   INV-IAM-02: username unique across the platform (DB unique index).
 *   INV-IAM-03: an ACTIVE user must have at least one role binding
 *               (enforced by the application layer on activation/assignment).
 *   INV-IAM-04: passwordHash must be present when authProvider == LOCAL
 *               (SSO-only users have no local password).
 *   INV-IAM-05: status transitions follow ACTIVE → SUSPENDED → DEACTIVATED
 *               and ACTIVE → LOCKED → ACTIVE; other jumps are rejected.
 *
 * Behaviors raise domain events recorded on the aggregate; the repository
 * drains them into the transactional outbox on save.
 */
import { AggregateRoot, type Brand } from '@fleetvision/shared-kernel';
import { IllegalStatusTransitionError } from './errors.js';
import {
  AuthLoginFailedEvent,
  AuthLoginSucceededEvent,
  type EventContext,
  RoleAssignedEvent,
  RoleRevokedEvent,
  UserActivatedEvent,
  UserCreatedEvent,
  UserDeactivatedEvent,
  UserLockedEvent,
  UserSuspendedEvent,
} from './events.js';

export type UserStatus = 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED' | 'LOCKED';

/** Props used to construct/rehydrate a User. */
export interface UserProps {
  readonly tenantId: string;
  readonly email: string;
  readonly username: string;
  /** Argon2id hash; null for SSO-only users (INV-IAM-04). */
  readonly passwordHash: string | null;
  readonly status: UserStatus;
  readonly displayName: string | null;
  readonly authProvider: string;
  readonly mfaEnabled: boolean;
  readonly lastLoginAt: Date | null;
  readonly failedLoginAttempts: number;
  readonly lockoutUntil: Date | null;
}

export class User extends AggregateRoot<Brand<string, 'UserId'>> {
  private readonly props: UserProps;
  /** Role bindings currently assigned (read model for token claims). */
  private roleIds: string[] = [];

  private constructor(id: string, version: number, props: UserProps) {
    super(id as Brand<string, 'UserId'>, version);
    this.props = { ...props };
  }

  // --- Factory --------------------------------------------------------------

  /**
   * Create a new local user. INV-IAM-04: passwordHash must be present for LOCAL
   * auth. Raises UserCreatedEvent.
   */
  public static create(
    id: string,
    props: Omit<
      UserProps,
      'status' | 'mfaEnabled' | 'lastLoginAt' | 'failedLoginAttempts' | 'lockoutUntil'
    > & {
      status?: UserStatus;
    },
    ctx: EventContext,
  ): User {
    if (props.authProvider === 'LOCAL' && !props.passwordHash) {
      throw new IllegalStatusTransitionError('LOCAL users must have a password hash (INV-IAM-04).');
    }
    const user = new User(id, 0, {
      ...props,
      status: props.status ?? 'ACTIVE',
      mfaEnabled: false,
      lastLoginAt: null,
      failedLoginAttempts: 0,
      lockoutUntil: null,
    });
    user.raise(
      new UserCreatedEvent(user.eventContext(ctx), props.email, props.username, props.authProvider),
    );
    return user;
  }

  /** Rehydrate from persistence (no events raised). */
  public static rehydrate(
    id: string,
    version: number,
    props: UserProps,
    roleIds: string[] = [],
  ): User {
    const user = new User(id, version, props);
    user.roleIds = [...roleIds];
    return user;
  }

  // --- Read accessors -------------------------------------------------------

  public get tenantId(): string {
    return this.props.tenantId;
  }
  public get email(): string {
    return this.props.email;
  }
  public get username(): string {
    return this.props.username;
  }
  public get passwordHash(): string | null {
    return this.props.passwordHash;
  }
  public get status(): UserStatus {
    return this.props.status;
  }
  public get displayName(): string | null {
    return this.props.displayName;
  }
  public get authProvider(): string {
    return this.props.authProvider;
  }
  public get mfaEnabled(): boolean {
    return this.props.mfaEnabled;
  }
  public get lastLoginAt(): Date | null {
    return this.props.lastLoginAt;
  }
  public get failedLoginAttempts(): number {
    return this.props.failedLoginAttempts;
  }
  public get lockoutUntil(): Date | null {
    return this.props.lockoutUntil;
  }
  public get roles(): readonly string[] {
    return this.roleIds;
  }

  // --- Behaviors ------------------------------------------------------------

  public isLocked(): boolean {
    return this.props.lockoutUntil !== null && this.props.lockoutUntil > new Date();
  }

  /** INV-IAM-05: ACTIVE → LOCKED transition allowed. */
  public lock(ctx: EventContext): void {
    this.requireTransition(['ACTIVE'], 'LOCKED');
    (this.props as { lockoutUntil: Date | null }).lockoutUntil = new Date(
      Date.now() + 15 * 60 * 1000,
    );
    (this.props as { status: UserStatus }).status = 'LOCKED';
    this.raise(new UserLockedEvent(this.eventContext(ctx)));
  }

  /** INV-IAM-05: LOCKED → ACTIVE unlock. */
  public unlock(ctx: EventContext): void {
    this.requireTransition(['LOCKED'], 'ACTIVE');
    (this.props as { lockoutUntil: Date | null }).lockoutUntil = null;
    (this.props as { failedLoginAttempts: number }).failedLoginAttempts = 0;
    (this.props as { status: UserStatus }).status = 'ACTIVE';
    this.raise(new UserActivatedEvent(this.eventContext(ctx)));
  }

  /** INV-IAM-05: SUSPENDED or LOCKED → ACTIVE (admin restore). */
  public activate(ctx: EventContext): void {
    if (this.props.status === 'LOCKED') {
      this.unlock(ctx);
      return;
    }
    this.requireTransition(['SUSPENDED'], 'ACTIVE');
    (this.props as { status: UserStatus }).status = 'ACTIVE';
    this.raise(new UserActivatedEvent(this.eventContext(ctx)));
  }

  public suspend(reason: string, ctx: EventContext): void {
    this.requireTransition(['ACTIVE', 'LOCKED'], 'SUSPENDED');
    (this.props as { status: UserStatus }).status = 'SUSPENDED';
    this.raise(new UserSuspendedEvent(this.eventContext(ctx), reason));
  }

  public deactivate(ctx: EventContext): void {
    this.requireTransition(['ACTIVE', 'SUSPENDED', 'LOCKED'], 'DEACTIVATED');
    (this.props as { status: UserStatus }).status = 'DEACTIVATED';
    this.raise(new UserDeactivatedEvent(this.eventContext(ctx)));
  }

  /** Record a failed login; lock the account after maxAttempts. */
  public recordFailedLogin(maxAttempts: number, ctx: EventContext): { locked: boolean } {
    const attempts = this.props.failedLoginAttempts + 1;
    (this.props as { failedLoginAttempts: number }).failedLoginAttempts = attempts;
    if (attempts >= maxAttempts) {
      this.lock(ctx);
      return { locked: true };
    }
    this.raise(new AuthLoginFailedEvent(this.eventContext(ctx), 'invalid credentials'));
    return { locked: false };
  }

  /** Record a successful login — reset counters, stamp lastLoginAt. */
  public recordSuccessfulLogin(
    sessionId: string,
    ipAddress: string | null,
    ctx: EventContext,
  ): void {
    (this.props as { failedLoginAttempts: number }).failedLoginAttempts = 0;
    (this.props as { lockoutUntil: Date | null }).lockoutUntil = null;
    (this.props as { lastLoginAt: Date | null }).lastLoginAt = new Date();
    this.raise(new AuthLoginSucceededEvent(this.eventContext(ctx), sessionId, ipAddress));
  }

  public changeEmail(newEmail: string): void {
    (this.props as { email: string }).email = newEmail;
  }

  public updatePasswordHash(hash: string): void {
    (this.props as { passwordHash: string | null }).passwordHash = hash;
  }

  public assignRole(roleId: string, scope: string | null, ctx: EventContext): void {
    if (!this.roleIds.includes(roleId)) {
      this.roleIds.push(roleId);
    }
    this.raise(new RoleAssignedEvent(this.eventContext(ctx), roleId, scope));
  }

  public revokeRole(roleId: string, ctx: EventContext): void {
    this.roleIds = this.roleIds.filter((r) => r !== roleId);
    this.raise(new RoleRevokedEvent(this.eventContext(ctx), roleId));
  }

  // --- Helpers --------------------------------------------------------------

  private requireTransition(from: UserStatus[], to: UserStatus): void {
    if (!from.includes(this.props.status)) {
      throw new IllegalStatusTransitionError(
        `Cannot transition user from ${this.props.status} to ${to} (INV-IAM-05).`,
      );
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
