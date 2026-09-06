/**
 * Platform SaaS-Ops tenant lifecycle — suspend (TEN-FR-07) and reactivate
 * (TEN-FR-08). Tenant id comes from the URL; authorization is
 * `billing.tenant.manage` on the controller.
 */
import { Injectable } from '@nestjs/common';
import { NotFoundError, type Tenant } from '../../domain/index.js';
import type { TenantRepository } from '../../infrastructure/persistence/tenant.repository.js';
import { buildEventContext } from '../shared/context.js';

@Injectable()
export class TenantLifecycleUseCase {
  constructor(private readonly tenants: TenantRepository) {}

  public async suspend(tenantId: string): Promise<Tenant> {
    const tenant = await this.requireTenant(tenantId);
    const ctx = buildEventContext(tenantId, 'tenant');
    tenant.suspend(ctx);
    await this.tenants.save(tenant, ctx);
    return tenant;
  }

  public async reactivate(tenantId: string): Promise<Tenant> {
    const tenant = await this.requireTenant(tenantId);
    const ctx = buildEventContext(tenantId, 'tenant');
    tenant.activate(ctx);
    await this.tenants.save(tenant, ctx);
    return tenant;
  }

  private async requireTenant(tenantId: string): Promise<Tenant> {
    const tenant = await this.tenants.findById(tenantId);
    if (!tenant) throw new NotFoundError('Tenant');
    return tenant;
  }
}
