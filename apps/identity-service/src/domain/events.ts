/**
 * IAM domain events. Each extends the CloudEvents-aligned DomainEvent base and
 * is raised by an aggregate on a state change; the repository publishes them
 * via the transactional outbox. Event types follow the
 * `iam.<aggregate>.<verb>.v1` convention (docs/specs/01_Master_Architecture.md
 * §6.2, Identity-Access-Management.md §6.1).
 */
import { DomainEvent, type FleetVisionEventContext } from '@fleetvision/shared-kernel';

const SOURCE = '/identity-service';

/**
 * Context required to raise domain events. Filled by the application layer with
 * the request's tenant id, correlation id, and the aggregate type name. Kept
 * here so every aggregate imports it from one place.
 */
export interface EventContext {
  readonly tenantId: string;
  readonly correlationId: string;
  readonly aggregateType: string;
}

/** Base for IAM events — fixes the source to the identity service. */
abstract class IamEvent extends DomainEvent {
  public readonly source = SOURCE;
}

// --- User lifecycle ---------------------------------------------------------

export class UserCreatedEvent extends IamEvent {
  public readonly type = 'iam.user.created.v1';
  constructor(
    context: FleetVisionEventContext,
    public readonly email: string,
    public readonly username: string,
    public readonly authProvider: string,
  ) {
    super(context);
  }
}

export class UserActivatedEvent extends IamEvent {
  public readonly type = 'iam.user.activated.v1';
}

export class UserSuspendedEvent extends IamEvent {
  public readonly type = 'iam.user.suspended.v1';
  constructor(
    context: FleetVisionEventContext,
    public readonly reason: string,
  ) {
    super(context);
  }
}

export class UserDeactivatedEvent extends IamEvent {
  public readonly type = 'iam.user.deactivated.v1';
}

export class UserLockedEvent extends IamEvent {
  public readonly type = 'iam.user.locked.v1';
}

// --- Role assignment --------------------------------------------------------

export class RoleAssignedEvent extends IamEvent {
  public readonly type = 'iam.role.assigned.v1';
  constructor(
    context: FleetVisionEventContext,
    public readonly roleId: string,
    public readonly scope: string | null,
  ) {
    super(context);
  }
}

export class RoleRevokedEvent extends IamEvent {
  public readonly type = 'iam.role.revoked.v1';
  constructor(
    context: FleetVisionEventContext,
    public readonly roleId: string,
  ) {
    super(context);
  }
}

// --- Auth -------------------------------------------------------------------

export class AuthLoginSucceededEvent extends IamEvent {
  public readonly type = 'iam.auth.login.succeeded.v1';
  constructor(
    context: FleetVisionEventContext,
    public readonly sessionId: string,
    public readonly ipAddress: string | null,
  ) {
    super(context);
  }
}

export class AuthLoginFailedEvent extends IamEvent {
  public readonly type = 'iam.auth.login.failed.v1';
  constructor(
    context: FleetVisionEventContext,
    public readonly reason: string,
  ) {
    super(context);
  }
}

export class AuthTokenRefreshedEvent extends IamEvent {
  public readonly type = 'iam.auth.token.refreshed.v1';
}

export class AuthTokenRevokedEvent extends IamEvent {
  public readonly type = 'iam.auth.token.revoked.v1';
  constructor(
    context: FleetVisionEventContext,
    public readonly reason: string,
  ) {
    super(context);
  }
}

export class AuthLogoutEvent extends IamEvent {
  public readonly type = 'iam.auth.logout.v1';
}

// --- Tenant -----------------------------------------------------------------

export class TenantProvisionedEvent extends IamEvent {
  public readonly type = 'billing.tenant.provisioned.v1';
  constructor(
    context: FleetVisionEventContext,
    public readonly name: string,
    public readonly tier: string,
  ) {
    super(context);
  }
}

export class TenantSuspendedEvent extends IamEvent {
  public readonly type = 'billing.tenant.suspended.v1';
}

export class TenantActivatedEvent extends IamEvent {
  public readonly type = 'billing.tenant.activated.v1';
}

// --- API key ----------------------------------------------------------------

export class ApiKeyCreatedEvent extends IamEvent {
  public readonly type = 'iam.apikey.created.v1';
  constructor(
    context: FleetVisionEventContext,
    public readonly keyPrefix: string,
  ) {
    super(context);
  }
}

export class ApiKeyRevokedEvent extends IamEvent {
  public readonly type = 'iam.apikey.revoked.v1';
}
