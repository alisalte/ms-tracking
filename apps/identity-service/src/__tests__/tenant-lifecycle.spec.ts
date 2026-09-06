import { describe, expect, it, jest } from '@jest/globals';
import { createTenantAccessSchema, provisionTenantSchema } from '../api/auth/auth.dto.js';
import { TenantLifecycleUseCase } from '../application/tenants/tenant-lifecycle.use-case.js';
import { IllegalStatusTransitionError, NotFoundError } from '../domain/errors.js';
import type { EventContext } from '../domain/events.js';
import { Tenant } from '../domain/tenant.js';
import type { TenantRepository } from '../infrastructure/persistence/tenant.repository.js';

const ctx: EventContext = {
  tenantId: 'tenant-1',
  correlationId: 'corr-1',
  aggregateType: 'tenant',
};

function activeTenant(): Tenant {
  const t = Tenant.provision(
    'tenant-1',
    { name: 'Acme', tier: 'STANDARD', region: 'us-east-1' },
    ctx,
  );
  t.activate(ctx);
  t.pullEvents();
  return t;
}

describe('TenantLifecycleUseCase', () => {
  it('suspends an active tenant and persists it', async () => {
    const tenant = activeTenant();
    const tenants = {
      findById: jest.fn(async () => tenant),
      save: jest.fn(async () => undefined),
    } as unknown as TenantRepository;
    const uc = new TenantLifecycleUseCase(tenants);
    const out = await uc.suspend('tenant-1');
    expect(out.status).toBe('SUSPENDED');
    expect(tenants.save).toHaveBeenCalledTimes(1);
  });

  it('reactivates a suspended tenant', async () => {
    const tenant = activeTenant();
    tenant.suspend(ctx);
    tenant.pullEvents();
    const tenants = {
      findById: jest.fn(async () => tenant),
      save: jest.fn(async () => undefined),
    } as unknown as TenantRepository;
    const uc = new TenantLifecycleUseCase(tenants);
    const out = await uc.reactivate('tenant-1');
    expect(out.status).toBe('ACTIVE');
  });

  it('404s when the tenant is missing', async () => {
    const tenants = {
      findById: jest.fn(async () => null),
      save: jest.fn(async () => undefined),
    } as unknown as TenantRepository;
    const uc = new TenantLifecycleUseCase(tenants);
    await expect(uc.suspend('missing')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('rejects suspending a tenant that is not ACTIVE', async () => {
    const tenant = Tenant.provision('t', { name: 'X', tier: 'STANDARD', region: 'r' }, ctx);
    const tenants = {
      findById: jest.fn(async () => tenant),
      save: jest.fn(async () => undefined),
    } as unknown as TenantRepository;
    const uc = new TenantLifecycleUseCase(tenants);
    await expect(uc.suspend('t')).rejects.toBeInstanceOf(IllegalStatusTransitionError);
    expect(tenants.save).not.toHaveBeenCalled();
  });
});

describe('platform tenant DTOs (INV-I02)', () => {
  it('provision schema strips tenant_id', () => {
    const result = provisionTenantSchema.safeParse({
      name: 'North Fleet',
      tier: 'STANDARD',
      region: 'local',
      admin_email: 'admin@north.example',
      admin_username: 'north-admin',
      admin_password: 'ChangeMe!Strong1',
      tenant_id: 'should-not-stick',
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).not.toHaveProperty('tenant_id');
  });

  it('create-access schema defaults role to viewer and strips tenant_id', () => {
    const result = createTenantAccessSchema.safeParse({
      email: 'op@north.example',
      username: 'north-op',
      password: 'ChangeMe!Strong1',
      tenant_id: 'nope',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.role_name).toBe('viewer');
      expect(result.data).not.toHaveProperty('tenant_id');
    }
  });
});
