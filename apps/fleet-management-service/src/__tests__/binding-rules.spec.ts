import { describe, expect, it, jest } from '@jest/globals';
import { BindingService } from '../application/binding.service.js';
import type { ActorContext } from '../application/service-context.js';

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const VEHICLE_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const VEHICLE_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const DEVICE_A = '11111111-2222-3333-4444-555555555555';

const actor: ActorContext = {
  tenantId: TENANT_A,
  actorId: 'user-1',
  actorType: 'USER',
  requestId: 'req-1',
  ipAddress: null,
  userAgent: null,
};

/** Minimal row fixtures (only the fields BindingService reads). */
const vehicleRow = { id: VEHICLE_A, tenant_id: TENANT_A, fleet_id: 'f-1' };
const deviceRow = {
  id: DEVICE_A,
  tenant_id: TENANT_A,
  imei: '351234567890124',
  manufacturer: null,
  model: null,
  protocol: 'gt06',
  status: 'ACTIVE',
};

interface FakeOpts {
  vehicle?: unknown;
  device?: unknown;
  bindingToThis?: unknown;
  bindingByDevice?: unknown;
  hasPrimary?: boolean;
}

function makeService(opts: FakeOpts = {}) {
  const bindMock = jest.fn(async () => ({ id: 'binding-1' }));
  const appendMock = jest.fn(async () => {});
  const vehicles = {
    findById: async (_t: string, _id: string) => opts.vehicle ?? null,
  };
  const devices = {
    findById: async (_t: string, _id: string) => opts.device ?? null,
  };
  const bindings = {
    findBinding: async () => opts.bindingToThis ?? null,
    findBindingByDevice: async () => opts.bindingByDevice ?? null,
    hasPrimaryDevice: async () => opts.hasPrimary ?? false,
    bind: bindMock,
    unbind: async () => ({ id: 'binding-1' }),
    listDevicesForVehicle: async () => [],
  };
  const audit = { append: appendMock };
  // Fake knex: withTenantContext only needs transaction(async fn) + trx.raw().
  const knex = {
    transaction: async (fn: (trx: { raw: () => Promise<unknown> }) => Promise<unknown>) =>
      fn({ raw: async () => ({}) }),
  };
  const service = new BindingService(
    knex as never,
    vehicles as never,
    devices as never,
    bindings as never,
    audit as never,
  );
  return { service, bindMock, appendMock };
}

describe('BindingService invariants (§11, §26, §33)', () => {
  it('rejects a vehicle not in the caller tenant (cross-tenant → 404, no leak)', async () => {
    const { service } = makeService({ device: deviceRow }); // vehicle missing
    await expect(service.bind(actor, VEHICLE_A, DEVICE_A, {})).rejects.toThrow(/Vehicle not found/);
  });

  it('rejects a device not in the caller tenant (cross-tenant → 404)', async () => {
    const { service } = makeService({ vehicle: vehicleRow }); // device missing
    await expect(service.bind(actor, VEHICLE_A, DEVICE_A, {})).rejects.toThrow(/Device not found/);
  });

  it('rejects a duplicate binding to the same vehicle (409)', async () => {
    const { service } = makeService({
      vehicle: vehicleRow,
      device: deviceRow,
      bindingToThis: { id: 'existing' },
    });
    await expect(service.bind(actor, VEHICLE_A, DEVICE_A, {})).rejects.toThrow(
      /already bound to this vehicle/,
    );
  });

  it('rejects a device already bound to another vehicle (409)', async () => {
    const { service } = makeService({
      vehicle: vehicleRow,
      device: deviceRow,
      bindingByDevice: { vehicle_id: VEHICLE_B },
    });
    await expect(service.bind(actor, VEHICLE_A, DEVICE_A, {})).rejects.toThrow(
      /already bound to another vehicle/,
    );
  });

  it('rejects a second primary device on the same vehicle (409)', async () => {
    const { service } = makeService({
      vehicle: vehicleRow,
      device: deviceRow,
      hasPrimary: true,
    });
    await expect(service.bind(actor, VEHICLE_A, DEVICE_A, {})).rejects.toThrow(
      /already has a primary device/,
    );
  });

  it('binds successfully, defaults role=TRACKER/isPrimary=true, and audits', async () => {
    const { service, bindMock, appendMock } = makeService({
      vehicle: vehicleRow,
      device: deviceRow,
    });
    const view = await service.bind(actor, VEHICLE_A, DEVICE_A, {});
    expect(bindMock).toHaveBeenCalledWith(
      expect.anything(),
      TENANT_A,
      VEHICLE_A,
      DEVICE_A,
      'TRACKER',
      true,
    );
    expect(appendMock).toHaveBeenCalledTimes(1);
    expect(appendMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'device.bound' }),
    );
    expect(view.deviceId).toBe(DEVICE_A);
    expect(view.isPrimary).toBe(true);
    expect(view.role).toBe('TRACKER');
  });

  it('honors an explicit non-primary role', async () => {
    const { service, bindMock } = makeService({ vehicle: vehicleRow, device: deviceRow });
    await service.bind(actor, VEHICLE_A, DEVICE_A, { role: 'MDVR', isPrimary: false });
    expect(bindMock).toHaveBeenCalledWith(
      expect.anything(),
      TENANT_A,
      VEHICLE_A,
      DEVICE_A,
      'MDVR',
      false,
    );
  });

  it('unbind rejects when the binding does not exist (404)', async () => {
    const { service } = makeService({ vehicle: vehicleRow }); // bindingToThis null
    await expect(service.unbind(actor, VEHICLE_A, DEVICE_A)).rejects.toThrow(/not bound/);
  });

  it('unbind succeeds and audits when the binding exists', async () => {
    const { service, appendMock } = makeService({
      vehicle: vehicleRow,
      bindingToThis: { id: 'binding-1' },
    });
    await service.unbind(actor, VEHICLE_A, DEVICE_A);
    expect(appendMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'device.unbound' }),
    );
  });
});
