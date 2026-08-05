import { describe, expect, it } from '@jest/globals';
import { IllegalStatusTransitionError } from '../domain/errors.js';
import type { EventContext } from '../domain/events.js';
import { Tenant } from '../domain/tenant.js';

const ctx: EventContext = {
  tenantId: 'tenant-1',
  correlationId: 'corr-1',
  aggregateType: 'tenant',
};

describe('Tenant aggregate (lifecycle state machine)', () => {
  it('starts in PROVISIONING and activates', () => {
    const tenant = Tenant.provision(
      'tenant-1',
      { name: 'Acme', tier: 'STANDARD', region: 'us-east-1' },
      ctx,
    );
    expect(tenant.status).toBe('PROVISIONING');
    tenant.activate(ctx);
    expect(tenant.status).toBe('ACTIVE');
    expect(tenant.isActive()).toBe(true);
  });

  it('suspends and reactivates an active tenant', () => {
    const tenant = activeTenant();
    tenant.suspend(ctx);
    expect(tenant.status).toBe('SUSPENDED');
    tenant.activate(ctx);
    expect(tenant.status).toBe('ACTIVE');
  });

  it('rejects suspending a provisioning tenant', () => {
    const tenant = Tenant.provision('t', { name: 'X', tier: 'STANDARD', region: 'r' }, ctx);
    expect(() => tenant.suspend(ctx)).toThrow(IllegalStatusTransitionError);
  });

  it('provisioned event is raised on creation', () => {
    const tenant = Tenant.provision('t', { name: 'X', tier: 'ENTERPRISE', region: 'r' }, ctx);
    const events = tenant.pullEvents();
    expect(events.some((e) => e.type === 'billing.tenant.provisioned.v1')).toBe(true);
  });
});

function activeTenant(): Tenant {
  const t = Tenant.provision(
    'tenant-1',
    { name: 'Acme', tier: 'STANDARD', region: 'us-east-1' },
    ctx,
  );
  t.activate(ctx);
  t.pullEvents(); // drain
  return t;
}
