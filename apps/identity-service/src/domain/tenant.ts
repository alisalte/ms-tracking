/**
 * Tenant aggregate — the top-level isolation boundary. Owns its lifecycle state
 * machine and tier (which drives features, quotas, and isolation).
 *
 * Lifecycle (Tenant-Management.md §4.1):
 *   [*] → PROVISIONING → ACTIVE ⇄ SUSPENDED → DEPROVISIONING → DEPROVISIONED
 *
 * `legal_hold=true` blocks deprovision/erasure (TEN-BR-09). region is pinned
 * and immutable after activation (TEN-BR-04).
 */
import { AggregateRoot, type Brand } from '@fleetvision/shared-kernel';
import { IllegalStatusTransitionError } from './errors.js';
import {
  type EventContext,
  TenantActivatedEvent,
  TenantProvisionedEvent,
  TenantSuspendedEvent,
} from './events.js';

export type TenantTier = 'STANDARD' | 'PROFESSIONAL' | 'ENTERPRISE';
export type TenantStatus =
  | 'PROVISIONING'
  | 'ACTIVE'
  | 'SUSPENDED'
  | 'DEPROVISIONING'
  | 'DEPROVISIONED';

export interface TenantProps {
  readonly name: string;
  readonly tier: TenantTier;
  readonly region: string;
  readonly status: TenantStatus;
  readonly featureFlags: Record<string, unknown>;
  readonly rootOrgId: string | null;
  readonly kekRef: string | null;
}

export class Tenant extends AggregateRoot<Brand<string, 'TenantId'>> {
  private readonly props: TenantProps;

  private constructor(id: string, version: number, props: TenantProps) {
    super(id as Brand<string, 'TenantId'>, version);
    this.props = { ...props };
  }

  /** Provision a new tenant (starts in PROVISIONING). */
  public static provision(
    id: string,
    init: { name: string; tier: TenantTier; region: string },
    ctx: EventContext,
  ): Tenant {
    const tenant = new Tenant(id, 0, {
      name: init.name,
      tier: init.tier,
      region: init.region,
      status: 'PROVISIONING',
      featureFlags: {},
      rootOrgId: null,
      kekRef: null,
    });
    tenant.raise(new TenantProvisionedEvent(tenant.eventContext(ctx), init.name, init.tier));
    return tenant;
  }

  public static rehydrate(id: string, version: number, props: TenantProps): Tenant {
    return new Tenant(id, version, props);
  }

  // --- Read accessors -------------------------------------------------------

  public get name(): string {
    return this.props.name;
  }
  public get tier(): TenantTier {
    return this.props.tier;
  }
  public get region(): string {
    return this.props.region;
  }
  public get status(): TenantStatus {
    return this.props.status;
  }
  public get featureFlags(): Record<string, unknown> {
    return this.props.featureFlags;
  }
  public get rootOrgId(): string | null {
    return this.props.rootOrgId;
  }
  public get kekRef(): string | null {
    return this.props.kekRef;
  }

  // --- Behaviors ------------------------------------------------------------

  /** Mark provisioned — all services acked. Transition PROVISIONING → ACTIVE. */
  public activate(ctx: EventContext): void {
    this.requireTransition(['PROVISIONING', 'SUSPENDED'], 'ACTIVE');
    (this.props as { status: TenantStatus }).status = 'ACTIVE';
    this.raise(new TenantActivatedEvent(this.eventContext(ctx)));
  }

  /** Suspend (quota breach / non-payment). ACTIVE/SUSPENDED-able→SUSPENDED. */
  public suspend(ctx: EventContext): void {
    this.requireTransition(['ACTIVE'], 'SUSPENDED');
    (this.props as { status: TenantStatus }).status = 'SUSPENDED';
    this.raise(new TenantSuspendedEvent(this.eventContext(ctx)));
  }

  public isActive(): boolean {
    return this.props.status === 'ACTIVE';
  }

  /**
   * @deprecated The Organization aggregate is an unimplemented scaffold (Sprint 2):
   * no OrganizationRepository/service/use-case exists. This setter has no
   * production caller. Will be wired when organizations are implemented.
   */
  public setRootOrg(orgId: string): void {
    (this.props as { rootOrgId: string | null }).rootOrgId = orgId;
  }

  private requireTransition(from: TenantStatus[], to: TenantStatus): void {
    if (!from.includes(this.props.status)) {
      throw new IllegalStatusTransitionError(
        `Cannot transition tenant from ${this.props.status} to ${to}.`,
      );
    }
  }

  private eventContext(ctx: EventContext) {
    return {
      tenant_id: this.id as string,
      correlation_id: ctx.correlationId,
      aggregate_id: this.id as string,
      aggregate_type: ctx.aggregateType,
      aggregate_version: this.version,
    };
  }
}
