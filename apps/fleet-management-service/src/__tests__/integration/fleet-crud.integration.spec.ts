import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { DeviceService } from '../../application/device.service.js';
import { FleetService } from '../../application/fleet.service.js';
import type { ActorContext } from '../../application/service-context.js';
import { VehicleService } from '../../application/vehicle.service.js';
import { AuditRepository } from '../../infrastructure/persistence/audit.repository.js';
import { DeviceRepository } from '../../infrastructure/persistence/device.repository.js';
import { FleetRepository } from '../../infrastructure/persistence/fleet.repository.js';
import { VehicleRepository } from '../../infrastructure/persistence/vehicle.repository.js';
import { type IntegrationCtx, bootstrap, seedTenant, truncateFleet } from './db.js';

const ctx = await bootstrap('fleetvision_fleet_crud_test');
const d = ctx ? describe : describe.skip;

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';

function actorFor(tenantId: string): ActorContext {
  return {
    tenantId,
    actorId: '33333333-3333-3333-3333-333333333333', // audit.audit_entries.actor_id is uuid
    actorType: 'USER',
    requestId: 'req-1',
    ipAddress: null,
    userAgent: null,
  };
}

/** Build a Luhn-valid IMEI from a 14-digit prefix. */
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

d('fleet-management integration — CRUD + uniqueness + isolation (§30)', () => {
  let c: IntegrationCtx;
  let fleets: FleetService;
  let vehicles: VehicleService;
  let devices: DeviceService;

  beforeAll(async () => {
    c = ctx as IntegrationCtx;
    const audit = new AuditRepository(c.knex);
    fleets = new FleetService(c.knex, new FleetRepository(c.knex), audit);
    vehicles = new VehicleService(
      c.knex,
      new VehicleRepository(c.knex),
      new FleetRepository(c.knex),
      audit,
    );
    devices = new DeviceService(c.knex, new DeviceRepository(c.knex), audit);
    await seedTenant(c.knex, TENANT_A);
    await seedTenant(c.knex, TENANT_B);
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

  it('creates a fleet, lists it (cursor), updates and archives it; writes audit', async () => {
    const fleet = await fleets.create(actorFor(TENANT_A), { name: 'North Ops', code: 'NORTH' });
    expect(fleet.status).toBe('ACTIVE');

    const page = await fleets.list(actorFor(TENANT_A), {}, { limit: 10 });
    expect(page.data).toHaveLength(1);
    expect(page.nextCursor).toBeNull();

    const updated = await fleets.update(actorFor(TENANT_A), fleet.id, {
      name: 'North Operations',
      code: 'NORTH',
    });
    expect(updated.name).toBe('North Operations');
    expect(updated.version).toBe(2);

    const archived = await fleets.archive(actorFor(TENANT_A), fleet.id);
    expect(archived.status).toBe('ARCHIVED');

    const audits = await c
      .knex('audit.audit_entries')
      .where({ tenant_id: TENANT_A, resource_type: 'fleet' })
      .orderBy('seq_no', 'asc');
    expect(audits.length).toBeGreaterThanOrEqual(3); // created + updated + archived
    expect(audits.map((a) => a.action)).toEqual(
      expect.arrayContaining(['fleet.created', 'fleet.updated', 'fleet.archived']),
    );
  });

  it('rejects a duplicate fleet code within a tenant (409)', async () => {
    await fleets.create(actorFor(TENANT_A), { name: 'A', code: 'DUP' });
    await expect(fleets.create(actorFor(TENANT_A), { name: 'B', code: 'DUP' })).rejects.toThrow(
      /already exists/,
    );
  });

  it('cursor paginates fleets (limit + nextCursor)', async () => {
    for (let i = 0; i < 3; i++) {
      await fleets.create(actorFor(TENANT_A), { name: `F${i}`, code: `F${i}` });
    }
    const first = await fleets.list(actorFor(TENANT_A), {}, { limit: 2 });
    expect(first.data).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    const cursor = first.nextCursor as string;
    const second = await fleets.list(actorFor(TENANT_A), {}, { limit: 2, cursor });
    expect(second.data).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
  });

  it('creates a vehicle under a fleet + filters list by fleetId', async () => {
    const fleet = await fleets.create(actorFor(TENANT_A), { name: 'F', code: 'F1' });
    const vehicle = await vehicles.create(actorFor(TENANT_A), {
      fleetId: fleet.id,
      name: 'Truck 1',
      code: 'TRK1',
      plate: 'ABC-123',
      odometerKm: 12500,
      engineHours: 4200,
    });
    expect(vehicle.plate).toBe('ABC-123');
    expect(vehicle.odometerKm).toBe(12500);
    expect(vehicle.engineHours).toBe(4200);
    const listed = await vehicles.list(actorFor(TENANT_A), { fleetId: fleet.id }, { limit: 10 });
    expect(listed.data).toHaveLength(1);
  });

  it('rejects a vehicle referencing a foreign-tenant fleet (cross-tenant → 404)', async () => {
    const fleetB = await fleets.create(actorFor(TENANT_B), { name: 'B Fleet', code: 'B1' });
    await expect(
      vehicles.create(actorFor(TENANT_A), {
        fleetId: fleetB.id,
        name: 'X',
        code: 'X1',
      }),
    ).rejects.toThrow(/Fleet not found/);
  });

  it('creates a device, searches by IMEI, filters by protocol', async () => {
    const im = imei('35123456789012');
    await devices.create(actorFor(TENANT_A), {
      imei: im,
      protocol: 'gt06',
      manufacturer: 'Concox',
    });
    const byImei = await devices.list(actorFor(TENANT_A), { imei: im.slice(0, 6) }, { limit: 10 });
    expect(byImei.data).toHaveLength(1);
    const byProto = await devices.list(actorFor(TENANT_A), { protocol: 'jt808' }, { limit: 10 });
    expect(byProto.data).toHaveLength(0);
  });

  it('disables (SUSPENDED) and decommissions a device; DELETE never hard-deletes', async () => {
    const dev = await devices.create(actorFor(TENANT_A), {
      imei: imei('35123456789012'),
      protocol: 'gt06',
    });
    const susp = await devices.setStatus(
      actorFor(TENANT_A),
      dev.id,
      'SUSPENDED',
      'device.disabled',
    );
    expect(susp.status).toBe('SUSPENDED');
    const decomm = await devices.setStatus(
      actorFor(TENANT_A),
      dev.id,
      'DECOMMISSIONED',
      'device.disabled',
    );
    expect(decomm.status).toBe('DECOMMISSIONED');
    // Row still exists (history preserved):
    const stillThere = await c.knex('fleet.devices').whereRaw('id = ?::uuid', [dev.id]).first();
    expect(stillThere).toBeTruthy();
  });

  // --- Tenant isolation (§33) ----------------------------------------------

  it('Tenant A cannot read/update/archive Tenant B fleet (404)', async () => {
    const fleetB = await fleets.create(actorFor(TENANT_B), { name: 'B', code: 'B1' });
    await expect(fleets.get(actorFor(TENANT_A), fleetB.id)).rejects.toThrow(/not found/);
    await expect(
      fleets.update(actorFor(TENANT_A), fleetB.id, { name: 'X', code: 'B1' }),
    ).rejects.toThrow(/not found/);
    await expect(fleets.archive(actorFor(TENANT_A), fleetB.id)).rejects.toThrow(/not found/);
  });

  it('Tenant A cannot read Tenant B device (no cross-tenant leak)', async () => {
    const dev = await devices.create(actorFor(TENANT_B), {
      imei: imei('35123456789012'),
      protocol: 'gt06',
    });
    await expect(devices.get(actorFor(TENANT_A), dev.id)).rejects.toThrow(/not found/);
  });
});
