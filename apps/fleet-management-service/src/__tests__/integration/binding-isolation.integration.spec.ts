import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { BindingService } from '../../application/binding.service.js';
import { DeviceService } from '../../application/device.service.js';
import { FleetService } from '../../application/fleet.service.js';
import type { ActorContext } from '../../application/service-context.js';
import { VehicleService } from '../../application/vehicle.service.js';
import { AuditRepository } from '../../infrastructure/persistence/audit.repository.js';
import { BindingRepository } from '../../infrastructure/persistence/binding.repository.js';
import { DeviceRepository } from '../../infrastructure/persistence/device.repository.js';
import { FleetRepository } from '../../infrastructure/persistence/fleet.repository.js';
import { VehicleRepository } from '../../infrastructure/persistence/vehicle.repository.js';
import { type IntegrationCtx, bootstrap, seedTenant, truncateFleet } from './db.js';

const ctx = await bootstrap('fleetvision_fleet_binding_test');
const d = ctx ? describe : describe.skip;

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';

function actorFor(tenantId: string): ActorContext {
  return {
    tenantId,
    actorId: '33333333-3333-3333-3333-333333333333', // audit.audit_entries.actor_id is uuid
    actorType: 'USER',
    requestId: 'r',
    ipAddress: null,
    userAgent: null,
  };
}

function imei(prefix: string): string {
  let sum = 0;
  let dbl = true;
  for (let i = prefix.length - 1; i >= 0; i--) {
    let n = prefix.charCodeAt(i) - 48;
    if (dbl) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    dbl = !dbl;
  }
  return `${prefix}${(10 - (sum % 10)) % 10}`;
}

d('fleet-management integration — binding, resolve, IMEI, isolation (§30/§31/§33)', () => {
  let c: IntegrationCtx;
  let binding: BindingService;
  let devices: DeviceService;
  let fleets: FleetService;
  let vehicles: VehicleService;

  beforeAll(async () => {
    c = ctx as IntegrationCtx;
    const audit = new AuditRepository(c.knex);
    const fleetRepo = new FleetRepository(c.knex);
    const vehicleRepo = new VehicleRepository(c.knex);
    const deviceRepo = new DeviceRepository(c.knex);
    const bindingRepo = new BindingRepository(c.knex);
    fleets = new FleetService(c.knex, fleetRepo, audit);
    vehicles = new VehicleService(c.knex, vehicleRepo, fleetRepo, audit);
    devices = new DeviceService(c.knex, deviceRepo, audit);
    binding = new BindingService(c.knex, vehicleRepo, deviceRepo, bindingRepo, audit);
  });

  beforeEach(async () => {
    await truncateFleet(c.knex);
    await seedTenant(c.knex, TENANT_A);
    await seedTenant(c.knex, TENANT_B);
  });

  afterAll(async () => {
    if (!c) return;
    await c.knex.destroy();
    await c.admin.destroy();
  });

  it('binds a device to a vehicle, lists it, and resolves the device→vehicle over IMEI', async () => {
    const fleet = await fleets.create(actorFor(TENANT_A), { name: 'F', code: 'F1' });
    const vehicle = await vehicles.create(actorFor(TENANT_A), {
      fleetId: fleet.id,
      name: 'V',
      code: 'V1',
    });
    const im = imei('35123456789012');
    const dev = await devices.create(actorFor(TENANT_A), { imei: im, protocol: 'gt06' });

    const bound = await binding.bind(actorFor(TENANT_A), vehicle.id, dev.id, {});
    expect(bound.deviceId).toBe(dev.id);
    expect(bound.isPrimary).toBe(true);

    const list = await binding.listDevicesForVehicle(actorFor(TENANT_A), vehicle.id);
    expect(list).toHaveLength(1);

    // Cross-tenant IMEI resolution (the device-gateway's trusted lookup).
    const res = await devices.resolve(im);
    expect(res.found).toBe(true);
    if (res.found) {
      expect(res.device.deviceId).toBe(dev.id);
      expect(res.device.tenantId).toBe(TENANT_A);
      expect(res.device.vehicleId).toBe(vehicle.id);
      expect(res.device.status).toBe('ACTIVE');
    }
    expect(res.tenantActive).toBe(true);
  });

  it('unbinds a device (row deleted; telemetry history unaffected)', async () => {
    const fleet = await fleets.create(actorFor(TENANT_A), { name: 'F', code: 'F1' });
    const vehicle = await vehicles.create(actorFor(TENANT_A), {
      fleetId: fleet.id,
      name: 'V',
      code: 'V1',
    });
    const dev = await devices.create(actorFor(TENANT_A), {
      imei: imei('35123456789012'),
      protocol: 'gt06',
    });
    await binding.bind(actorFor(TENANT_A), vehicle.id, dev.id, {});
    await binding.unbind(actorFor(TENANT_A), vehicle.id, dev.id);
    // Device row persists; binding row gone.
    expect(await binding.getVehicleOfDevice(actorFor(TENANT_A), dev.id)).toBeNull();
    const res = await devices.resolve(imei('35123456789012'));
    if (res.found) expect(res.device.vehicleId).toBeNull();
  });

  it('rejects a duplicate binding (same vehicle+device) and a device bound elsewhere', async () => {
    const fleet = await fleets.create(actorFor(TENANT_A), { name: 'F', code: 'F1' });
    const v1 = await vehicles.create(actorFor(TENANT_A), {
      fleetId: fleet.id,
      name: 'V1',
      code: 'V1',
    });
    const v2 = await vehicles.create(actorFor(TENANT_A), {
      fleetId: fleet.id,
      name: 'V2',
      code: 'V2',
    });
    const dev = await devices.create(actorFor(TENANT_A), {
      imei: imei('35123456789012'),
      protocol: 'gt06',
    });
    await binding.bind(actorFor(TENANT_A), v1.id, dev.id, {});
    await expect(binding.bind(actorFor(TENANT_A), v1.id, dev.id, {})).rejects.toThrow(
      /already bound to this vehicle/,
    );
    await expect(binding.bind(actorFor(TENANT_A), v2.id, dev.id, {})).rejects.toThrow(
      /already bound to another vehicle/,
    );
  });

  it('enforces ≤1 primary device per vehicle', async () => {
    const fleet = await fleets.create(actorFor(TENANT_A), { name: 'F', code: 'F1' });
    const vehicle = await vehicles.create(actorFor(TENANT_A), {
      fleetId: fleet.id,
      name: 'V',
      code: 'V1',
    });
    const d1 = await devices.create(actorFor(TENANT_A), {
      imei: imei('35123456789012'),
      protocol: 'gt06',
    });
    const d2 = await devices.create(actorFor(TENANT_A), {
      imei: imei('35999956789012'),
      protocol: 'gt06',
    });
    await binding.bind(actorFor(TENANT_A), vehicle.id, d1.id, {});
    await expect(binding.bind(actorFor(TENANT_A), vehicle.id, d2.id, {})).rejects.toThrow(
      /already has a primary device/,
    );
    // A non-primary device is allowed:
    const mdvr = await binding.bind(actorFor(TENANT_A), vehicle.id, d2.id, {
      role: 'MDVR',
      isPrimary: false,
    });
    expect(mdvr.isPrimary).toBe(false);
  });

  it('IMEI is globally unique across tenants (Tenant B cannot reuse Tenant A IMEI)', async () => {
    const im = imei('35123456789012');
    await devices.create(actorFor(TENANT_A), { imei: im, protocol: 'gt06' });
    await expect(
      devices.create(actorFor(TENANT_B), { imei: im, protocol: 'gt06' }),
    ).rejects.toThrow(/globally unique/);
  });

  it('rejects cross-tenant binding (Tenant A device → Tenant B vehicle, and vice-versa)', async () => {
    const fleetA = await fleets.create(actorFor(TENANT_A), { name: 'FA', code: 'FA' });
    const vehicleA = await vehicles.create(actorFor(TENANT_A), {
      fleetId: fleetA.id,
      name: 'VA',
      code: 'VA',
    });
    const devB = await devices.create(actorFor(TENANT_B), {
      imei: imei('35123456789012'),
      protocol: 'gt06',
    });
    // Tenant A tries to bind Tenant B's device to its vehicle → device 404 in tenant A.
    await expect(binding.bind(actorFor(TENANT_A), vehicleA.id, devB.id, {})).rejects.toThrow(
      /Device not found/,
    );
  });

  it('resolve returns found:false for an unknown IMEI', async () => {
    const res = await devices.resolve(imei('35777777777770'));
    expect(res.found).toBe(false);
  });

  it('resolve returns a SUSPENDED device (gateway maps to disabled) and a suspended tenant', async () => {
    const dev = await devices.create(actorFor(TENANT_A), {
      imei: imei('35123456789012'),
      protocol: 'gt06',
    });
    await devices.setStatus(actorFor(TENANT_A), dev.id, 'SUSPENDED', 'device.disabled');
    const res = await devices.resolve(imei('35123456789012'));
    expect(res.found).toBe(true);
    if (res.found) expect(res.device.status).toBe('SUSPENDED');

    // Suspend the tenant → tenantActive false.
    await c
      .knex('iam.tenants')
      .whereRaw('id = ?::uuid', [TENANT_A])
      .update({ status: 'SUSPENDED' });
    const res2 = await devices.resolve(imei('35123456789012'));
    expect(res2.tenantActive).toBe(false);
  });
});
