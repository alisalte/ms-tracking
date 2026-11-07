import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Knex } from '@fleetvision/persistence-knex';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { DriverPhotoRepository } from '../../infrastructure/persistence/driver-photo.repository.js';
import { type IntegrationCtx, bootstrap, seedTenant } from './db.js';

const ctx = await bootstrap('fleetvision_driver_photo_test');
const d = ctx ? describe : describe.skip;

const TENANT = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';
const DEVICE = '33333333-3333-3333-3333-333333333333';
const DRIVER = '44444444-4444-4444-4444-444444444444';
const VEHICLE = '55555555-5555-5555-5555-555555555555';
const FLEET = '66666666-6666-6666-6666-666666666666';

/** fleet.drivers comes from fleet-service migrations (same database in production). */
async function applyFleetServiceMigrations(knex: Knex): Promise<void> {
  const dir = resolve(process.cwd(), '../fleet-service/src/infrastructure/database/migrations');
  for (const file of readdirSync(dir)
    .filter((f) => f.endsWith('.js'))
    .sort()) {
    const mod = (await import(pathToFileURL(resolve(dir, file)).href)) as {
      up: (k: Knex) => Promise<void>;
    };
    await mod.up(knex);
  }
}

d('driver photos repository (Postgres)', () => {
  let c: IntegrationCtx;
  let repo: DriverPhotoRepository;

  beforeAll(async () => {
    c = ctx as IntegrationCtx;
    await applyFleetServiceMigrations(c.knex);
    await seedTenant(c.knex, TENANT);
    await seedTenant(c.knex, OTHER);
    await c.knex('fleet.devices').insert({
      id: DEVICE,
      tenant_id: TENANT,
      imei: '359000000000001',
      protocol: 'meitrack',
      status: 'ACTIVE',
    });
    await c
      .knex('fleet.fleets')
      .insert({ id: FLEET, tenant_id: TENANT, name: 'Mine', code: 'MINE' });
    await c.knex('fleet.vehicles').insert({
      id: VEHICLE,
      tenant_id: TENANT,
      fleet_id: FLEET,
      name: 'Truck 7',
      code: 'T7',
    });
    await c.knex('fleet.vehicle_devices').insert({
      tenant_id: TENANT,
      vehicle_id: VEHICLE,
      device_id: DEVICE,
    });
    await c.knex('fleet.drivers').insert({
      id: DRIVER,
      tenant_id: TENANT,
      first_name: 'Ali',
      last_name: 'Rezaei',
      license_number: 'L-1',
      status: 'ACTIVE',
    });
    repo = new DriverPhotoRepository(c.knex);
  });

  afterAll(async () => {
    if (!ctx) return;
    await ctx.knex.destroy();
    await ctx.admin.raw(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'fleetvision_driver_photo_test'`,
    );
    await ctx.admin.raw('DROP DATABASE IF EXISTS "fleetvision_driver_photo_test"');
    await ctx.admin.destroy();
  });

  it('queues, enforces the cooldown, claims, stores and files a photo', async () => {
    expect(await repo.vehicleOfDevice(TENANT, DEVICE)).toBe(VEHICLE);
    const now = new Date();
    const base = {
      tenantId: TENANT,
      deviceId: DEVICE,
      vehicleId: VEHICLE,
      camera: 2,
      captureAfter: new Date(now.getTime() - 1000),
      cooldownMinutes: 30,
    };
    const id = await repo.request({ ...base, trigger: 'IGNITION', triggeredAt: now });
    expect(id).not.toBeNull();
    // Same device again within the cooldown → nothing queued; manual still works.
    expect(await repo.request({ ...base, trigger: 'CONNECT', triggeredAt: now })).toBeNull();
    const manual = await repo.request({ ...base, trigger: 'MANUAL', triggeredAt: now });
    expect(manual).not.toBeNull();

    const claimed = await repo.claimDue(10, true);
    expect(claimed.map((j) => j.id).sort()).toEqual([id, manual].sort());
    // Leased: a second claim right away sees nothing.
    expect(await repo.claimDue(10, true)).toHaveLength(0);

    const jpeg = Buffer.from([0xff, 0xd8, 0x01, 0x02, 0xff, 0xd9]);
    await repo.patch(TENANT, id as string, {
      status: 'READY',
      photo: jpeg,
      capturedAt: now,
      faceStatus: 'FOUND',
      embedding: [0.6, 0.8],
    });
    expect(await repo.loadPhoto(TENANT, id as string)).toEqual(jpeg);
    expect(await repo.loadPhoto(OTHER, id as string)).toBeNull();
    expect(await repo.loadEmbedding(TENANT, id as string)).toEqual([
      expect.closeTo(0.6, 5),
      expect.closeTo(0.8, 5),
    ]);

    expect(await repo.references(TENANT)).toHaveLength(0);
    expect(await repo.assign(TENANT, id as string, DRIVER, null)).toBe(true);
    const refs = await repo.references(TENANT);
    expect(refs).toEqual([{ driverId: DRIVER, embedding: expect.any(Array) }]);

    const [view] = await repo.list(TENANT, { matchStatus: 'CONFIRMED', limit: 10 });
    expect(view).toMatchObject({
      id,
      vehicleName: 'Truck 7',
      driverName: 'Ali Rezaei',
      matchStatus: 'CONFIRMED',
      deviceImei: '359000000000001',
    });
    const counts = await repo.counts(TENANT);
    expect(counts.confirmed).toBe(1);

    // Auto-match never overrides an operator's decision.
    expect(await repo.setAutoMatch(TENANT, id as string, DRIVER, 0.9)).toBe(false);

    // Clearing the driver returns the photo to the inbox.
    expect(await repo.assign(TENANT, id as string, null, null)).toBe(true);
    expect((await repo.list(TENANT, { matchStatus: 'UNASSIGNED', limit: 10 })).length).toBe(2);
    expect(await repo.remove(TENANT, manual as string)).toBe(true);
    expect(await repo.remove(OTHER, id as string)).toBe(false);
  });
});
