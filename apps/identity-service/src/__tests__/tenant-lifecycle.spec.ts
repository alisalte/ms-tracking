import { describe, expect, it } from '@jest/globals';
import { TenantLifecycleUseCase } from '../application/tenants/tenant-lifecycle.use-case.js';
import { Tenant as TenantClass } from '../domain/index.js';

/**
 * Phase 7: tenant suspend/activate must (a) run the Tenant state machine,
 * (b) persist via the repository, and (c) record a platform-scoped audit entry.
 */
function makeActiveTenant() {
  const tenant = TenantClass.provision(
    '11111111-1111-1111-1111-111111111111',
    { name: 'Acme', tier: 'STANDARD', region: 'eu-west-1' },
    {
      tenantId: '11111111-1111-1111-1111-111111111111',
      correlationId: 'c',
      aggregateType: 'tenant',
    },
  );
  tenant.activate({
    tenantId: '11111111-1111-1111-1111-111111111111',
    correlationId: 'c',
    aggregateType: 'tenant',
  });
  return tenant;
}

function makeFakes() {
  let saved: { status: string } | null = null;
  const tenants = {
    findById: async () => makeActiveTenant(),
    save: async (t: ReturnType<typeof makeActiveTenant>) => {
      saved = { status: t.status };
    },
  };
  const recorded: unknown[] = [];
  const audit = {
    record: async (entry: unknown) => {
      recorded.push(entry);
    },
  };
  return { tenants, audit, getSaved: () => saved, getRecorded: () => recorded };
}

describe('TenantLifecycleUseCase.suspend', () => {
  it('transitions ACTIVE → SUSPENDED, persists, and audits', async () => {
    const { tenants, audit, getSaved, getRecorded } = makeFakes();
    const useCase = new TenantLifecycleUseCase(tenants as never, audit as never);
    const res = await useCase.suspend({
      tenantId: '11111111-1111-1111-1111-111111111111',
      actorId: 'admin-1',
      actorType: 'USER',
      ipAddress: '1.2.3.4',
      userAgent: 'jest',
      requestId: 'req-1',
    });
    expect(res.status).toBe('SUSPENDED');
    expect(getSaved()?.status).toBe('SUSPENDED');
    const entry = getRecorded()[0] as {
      action: string;
      platform: boolean;
      before: { status: string };
      after: { status: string };
    };
    expect(entry.action).toBe('billing.tenant.suspend');
    expect(entry.platform).toBe(true);
    expect(entry.before.status).toBe('ACTIVE');
    expect(entry.after.status).toBe('SUSPENDED');
  });
});

describe('TenantLifecycleUseCase.activate', () => {
  it('transitions SUSPENDED → ACTIVE, persists, and audits', async () => {
    const suspended = makeActiveTenant();
    suspended.suspend({
      tenantId: '11111111-1111-1111-1111-111111111111',
      correlationId: 'c',
      aggregateType: 'tenant',
    });
    const tenants = {
      findById: async () => suspended,
      save: async () => {},
    };
    const recorded: unknown[] = [];
    const audit = { record: async (e: unknown) => recorded.push(e) };
    const useCase = new TenantLifecycleUseCase(tenants as never, audit as never);
    const res = await useCase.activate({
      tenantId: '11111111-1111-1111-1111-111111111111',
      actorId: 'admin-1',
      actorType: 'USER',
      ipAddress: null,
      userAgent: null,
      requestId: null,
    });
    expect(res.status).toBe('ACTIVE');
    const entry = recorded[0] as { action: string; after: { status: string } };
    expect(entry.action).toBe('billing.tenant.activate');
    expect(entry.after.status).toBe('ACTIVE');
  });

  it('throws NotFoundError when the tenant does not exist', async () => {
    const tenants = { findById: async () => null, save: async () => {} };
    const audit = { record: async () => {} };
    const useCase = new TenantLifecycleUseCase(tenants as never, audit as never);
    await expect(
      useCase.suspend({
        tenantId: 'missing',
        actorId: 'admin-1',
        actorType: 'USER',
        ipAddress: null,
        userAgent: null,
        requestId: null,
      }),
    ).rejects.toThrow(/not found/i);
  });
});
