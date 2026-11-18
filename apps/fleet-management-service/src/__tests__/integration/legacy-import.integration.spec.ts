import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { BindingService } from '../../application/binding.service.js';
import { DeviceService } from '../../application/device.service.js';
import { LegacyImportService } from '../../application/legacy-import.service.js';
import type { ActorContext } from '../../application/service-context.js';
import { AuditRepository } from '../../infrastructure/persistence/audit.repository.js';
import { BindingRepository } from '../../infrastructure/persistence/binding.repository.js';
import { DeviceInboxRepository } from '../../infrastructure/persistence/device-inbox.repository.js';
import { DeviceRepository } from '../../infrastructure/persistence/device.repository.js';
import { FleetRepository } from '../../infrastructure/persistence/fleet.repository.js';
import { VehicleRepository } from '../../infrastructure/persistence/vehicle.repository.js';
import { type IntegrationCtx, bootstrap, seedTenant, truncateFleet } from './db.js';

const ctx = await bootstrap('fleetvision_fleet_legacy_import_test');
const d = ctx ? describe : describe.skip;

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';

const actor = (tenantId: string): ActorContext => ({
  tenantId,
  actorId: '33333333-3333-3333-3333-333333333333',
  actorType: 'USER',
  requestId: 'r',
  ipAddress: null,
  userAgent: null,
});

// Real IMEIs from the legacy objects export (Luhn-valid).
const IMEI_1 = '350424065844621';
const IMEI_2 = '357454071960254';

d('legacy unit import (upsert by IMEI)', () => {
  let c: IntegrationCtx;
  let service: LegacyImportService;
  let devices: DeviceService;

  beforeAll(async () => {
    c = ctx as IntegrationCtx;
    const audit = new AuditRepository(c.knex);
    const vehicleRepo = new VehicleRepository(c.knex);
    const deviceRepo = new DeviceRepository(c.knex);
    const bindingRepo = new BindingRepository(c.knex);
    const bindings = new BindingService(c.knex, vehicleRepo, deviceRepo, bindingRepo, audit);
    const inbox = new DeviceInboxRepository(c.knex);
    service = new LegacyImportService(c.knex, audit, bindingRepo, bindings, null, inbox);
    devices = new DeviceService(
      c.knex,
      deviceRepo,
      audit,
      null,
      vehicleRepo,
      bindings,
      new FleetRepository(c.knex),
      inbox,
    );
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

  it('creates fleet, tracker and vehicle from a legacy row and binds them', async () => {
    const r = await service.importUnits(actor(TENANT_A), [
      {
        row: 2,
        name: 'T 15-612 izst',
        imei: IMEI_1,
        fleet: 'پخش تهران',
        model: 'FMB120',
        simNumber: '+989018237131',
        odometerKm: 19121.6,
        legacyFields: { 'شیفت دما': '+3', 'نوع ماشين': 'ایسوزو' },
        groups: ['پخش تهران', 'همه ماشینها'],
      },
    ]);
    expect(r.rows[0]).toMatchObject({ outcome: 'CREATED', warnings: [] });
    expect(r.fleetsCreated).toEqual(['پخش تهران']);

    const dev = await c.knex('fleet.devices').where('imei', IMEI_1).first();
    expect(dev).toMatchObject({
      protocol: 'teltonika',
      model: 'FMB120',
      sim_number: '+989018237131',
    });
    const veh = await c.knex('fleet.vehicles').where('code', `L${IMEI_1}`).first();
    expect(veh).toMatchObject({ name: 'T 15-612 izst', temperature_offset_c: 3 });
    expect(Number(veh.odometer_km)).toBeCloseTo(19121.6);
    expect(veh.legacy_fields.groups).toEqual(['پخش تهران', 'همه ماشینها']);
    const bind = await c.knex('fleet.vehicle_devices').where('device_id', dev.id).first();
    expect(bind.vehicle_id).toBe(veh.id);
  });

  it('renames the auto-enrolled placeholder vehicle instead of duplicating it', async () => {
    await c.knex('fleet.device_inbox').delete();
    // First packet: the tracker auto-provisions "Device <imei>" on an AUTO fleet.
    const created = await devices.create(actor(TENANT_A), { imei: IMEI_2, protocol: 'teltonika' });
    const fleet = await c
      .knex('fleet.fleets')
      .insert({ tenant_id: TENANT_A, name: 'Auto', code: 'AUTO' })
      .returning('*');
    const [placeholder] = await c
      .knex('fleet.vehicles')
      .insert({
        tenant_id: TENANT_A,
        fleet_id: fleet[0].id,
        name: `Device ${IMEI_2}`,
        code: `D${IMEI_2}`,
      })
      .returning('*');
    await c.knex('fleet.vehicle_devices').insert({
      tenant_id: TENANT_A,
      vehicle_id: placeholder.id,
      device_id: created.id,
      role: 'TRACKER',
      is_primary: true,
    });

    const r = await service.importUnits(actor(TENANT_A), [
      {
        name: 'P 12-457 قنبري',
        imei: IMEI_2,
        fleet: 'پیمانکار',
        model: 'FM1120',
        simNumber: '+989013182018',
      },
    ]);
    expect(r.rows[0]?.outcome).toBe('UPDATED');
    const vehicles = await c.knex('fleet.vehicles').whereRaw('tenant_id = ?::uuid', [TENANT_A]);
    expect(vehicles).toHaveLength(1);
    expect(vehicles[0]).toMatchObject({ id: placeholder.id, name: 'P 12-457 قنبري' });
    expect(vehicles[0].fleet_id).not.toBe(fleet[0].id);

    // Re-running the same file changes nothing structurally.
    const again = await service.importUnits(actor(TENANT_A), [
      { name: 'P 12-457 قنبري', imei: IMEI_2, fleet: 'پیمانکار', model: 'FM1120' },
    ]);
    expect(again.rows[0]?.outcome).toBe('UPDATED');
    expect(again.fleetsCreated).toEqual([]);
    expect(await c.knex('fleet.vehicles').whereRaw('tenant_id = ?::uuid', [TENANT_A])).toHaveLength(
      1,
    );
  });

  it('refuses an IMEI owned by another account and an unknown model', async () => {
    await service.importUnits(actor(TENANT_B), [
      { name: 'B', imei: IMEI_1, fleet: 'X', model: 'FMB120' },
    ]);
    const r = await service.importUnits(actor(TENANT_A), [
      { row: 2, name: 'A', imei: IMEI_1, fleet: 'X', model: 'FMB120' },
      { row: 3, name: 'C', imei: IMEI_2, fleet: 'X', model: 'Unknown box' },
    ]);
    expect(r.rows.map((x) => x.outcome)).toEqual(['FAILED', 'FAILED']);
    expect(r.rows[0]?.error).toMatch(/another account/);
    expect(r.rows[1]?.error).toMatch(/protocol/);
  });
});
