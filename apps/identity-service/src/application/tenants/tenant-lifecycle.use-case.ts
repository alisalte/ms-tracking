/**
 * Tenant lifecycle use-case — suspend / activate a tenant. These are
 * platform SaaS-Ops operations (`billing.tenant.manage`) that must be audited
 * (Phase 7). The state transition itself is enforced by the Tenant aggregate
 * (IllegalStatusTransitionError → CONFLICT); the use-case persists the change
 * and records a platform-scoped audit entry.
 *
 * Suspend: ACTIVE → SUSPENDED. Activate: PROVISIONING|SUSPENDED → ACTIVE.
 */
import { Injectable } from '@nestjs/common';
import { NotFoundError } from '../../domain/errors.js';
import type { Tenant } from '../../domain/index.js';
import type { TenantRepository } from '../../infrastructure/persistence/tenant.repository.js';
import type { AuditActor, AuditManager } from '../audit/audit-manager.js';
import { buildEventContext } from '../shared/context.js';

export interface TenantLifecycleInput extends AuditActor {
  readonly tenantId: string;
  readonly correlationId?: string;
}

export interface TenantLifecycleResult {
  readonly tenantId: string;
  readonly status: string;
}

@Injectable()
export class TenantLifecycleUseCase {
  constructor(
    private readonly tenants: TenantRepository,
    private readonly audit: AuditManager,
  ) {}

  /** Suspend a tenant (ACTIVE → SUSPENDED). */
  public async suspend(input: TenantLifecycleInput): Promise<TenantLifecycleResult> {
    return this.apply(input, 'suspend', 'billing.tenant.suspend');
  }

  /** (Re)activate a tenant (PROVISIONING|SUSPENDED → ACTIVE). */
  public async activate(input: TenantLifecycleInput): Promise<TenantLifecycleResult> {
    return this.apply(input, 'activate', 'billing.tenant.activate');
  }

  private async apply(
    input: TenantLifecycleInput,
    op: 'suspend' | 'activate',
    action: string,
  ): Promise<TenantLifecycleResult> {
    const tenant = await this.tenants.findById(input.tenantId);
    if (!tenant) throw new NotFoundError('Tenant');

    const before = { status: tenant.status };
    const ctx = buildEventContext(input.tenantId, 'tenant', input.correlationId);
    if (op === 'suspend') {
      tenant.suspend(ctx);
    } else {
      tenant.activate(ctx);
    }
    await this.tenants.save(tenant, ctx);

    // Platform-scoped audit (tenant row lives outside the caller's tenant scope).
    await this.audit.record({
      tenantId: input.tenantId,
      actorId: input.actorId ?? null,
      actorType: input.actorId ? 'USER' : 'SYSTEM',
      action,
      resourceType: 'tenant',
      resourceId: input.tenantId,
      permission: 'billing.tenant.manage',
      outcome: 'SUCCESS',
      before,
      after: { status: tenant.status },
      requestId: input.requestId ?? null,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
      platform: true,
    });

    return { tenantId: input.tenantId, status: tenant.status };
  }
}

// Re-exported for callers that want the aggregate type alongside.
export type { Tenant };
