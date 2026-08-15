/**
 * Sprint C — gps-engine consumption leg of the device→gateway→Kafka→gps pipeline.
 *
 * The device-gateway E2E (apps/device-gateway-service) proves the gateway emits a
 * CloudEvents envelope carrying the REGISTRY-sourced, trusted tenantId/deviceId.
 * This test proves the receiving leg: that exact envelope shape, parsed by the
 * gps-engine's real `parsePositionEnvelope` and persisted by the real
 * `PositionRepository`, lands in `tracking.vehicle_positions` under the CORRECT
 * tenant — and that a cross-tenant caller cannot read it (§32 step 13, §33).
 *
 * Kafka is the documented seam between the two legs (the codebase runs no real
 * Kafka in tests); the envelope contract is what they share, and it is exercised
 * for real here against TimescaleDB.
 */
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { type Knex, createKnex } from '@fleetvision/persistence-knex';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { parsePositionEnvelope } from '../../infrastructure/kafka/envelope-parser.js';
import { PositionRepository } from '../../infrastructure/persistence/position.repository.js';

const TEST_DB = 'fleetvision_gps_envelope_test';
const ADMIN_URL =
  process.env.GPS_TEST_DBURL ??
  process.env.DBURL ??
  'postgres://fleetvision:fleetvision@localhost:5432/fleetvision';
const MIGRATIONS = resolve(process.cwd(), 'src/infrastructure/database/migrations');
// harden_tracking_rls is CJS-style and cannot be dynamic-imported under jest; it
// only rewrites RLS (not enforced for the test superuser).
const SKIP = ['20260813120000_harden_tracking_rls_policies.js'];

function testDbUrl(): string {
  return ADMIN_URL.replace(/\/[^/?]*$/, `/${TEST_DB}`);
}

async function bootstrap(): Promise<Knex | null> {
  let admin: Knex | null = null;
  let knex: Knex | null = null;
  try {
    admin = createKnex({ url: ADMIN_URL });
    await admin.raw('SELECT 1');
    await admin.raw(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${TEST_DB}'`,
    );
    await admin.raw(`DROP DATABASE IF EXISTS "${TEST_DB}"`);
    await admin.raw(`CREATE DATABASE "${TEST_DB}"`);
    knex = createKnex({ url: testDbUrl() });
    await knex.raw('CREATE EXTENSION IF NOT EXISTS timescaledb');
    await knex.raw('CREATE EXTENSION IF NOT EXISTS postgis');
    const files = readdirSync(MIGRATIONS)
      .filter((f) => f.endsWith('.js') && !SKIP.includes(f))
      .sort();
    for (const f of files) {
      const mod = (await import(pathToFileURL(resolve(MIGRATIONS, f)).href)) as {
        up: (knex: Knex) => Promise<void>;
      };
      await mod.up(knex);
    }
    await admin.destroy();
    return knex;
  } catch (e) {
    try {
      if (knex) await knex.destroy();
    } catch {
      /* ignore */
    }
    try {
      if (admin) await admin.destroy();
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line no-console
    console.warn(`[gps-envelope integration] skipped: ${(e as Error).message}`);
    return null;
  }
}

const knex = await bootstrap();
const d = knex ? describe : describe.skip;

d('gps-engine envelope → persistence under trusted tenant (§32 leg, §33)', () => {
  let repo: PositionRepository;

  beforeAll(() => {
    repo = new PositionRepository(knex as Knex);
  });

  afterAll(async () => {
    if (!knex) return;
    await (knex as Knex).destroy();
  });

  it('parses a gateway CloudEvents envelope and persists the position under its tenantId', async () => {
    const tenantId = '11111111-1111-1111-1111-111111111111';
    const deviceId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const messageId = '12345678-1234-1234-1234-123456789abc';
    const captured = '2026-08-14T10:00:00.000Z';
    // The EXACT envelope shape the device-gateway emits (kafka-producer.toEnvelope).
    const envelope = {
      specversion: '1.0',
      type: 'telemetry.position.raw.v1',
      time: '2026-08-14T10:00:00.500Z',
      id: messageId,
      messageId,
      deviceId,
      tenantId,
      protocolId: 'stub',
      messageType: 'POSITION',
      timestamp: captured,
      position: { latitude: 35.6, longitude: -118.2, speedKph: 42, headingDeg: 90 },
    };

    const event = parsePositionEnvelope(Buffer.from(JSON.stringify(envelope)));
    expect(event.tenantId).toBe(tenantId);
    // gps-engine treats deviceId as the entity key (07 §9.2 vehicleId=deviceId).
    expect(event.vehicleId).toBe(deviceId);

    await repo.insert(event);

    const row = await (knex as Knex)
      .withSchema('tracking')
      .from('vehicle_positions')
      .whereRaw('event_id = ?::uuid', [messageId])
      .first();
    expect(row).toBeTruthy();
    expect(row.tenant_id).toBe(tenantId);
    expect(row.vehicle_id).toBe(deviceId);
    // Idempotent redelivery (same messageId + captured_at) does not duplicate.
    await repo.insert(event);
    const count = Number(
      (
        await (knex as Knex)
          .withSchema('tracking')
          .from('vehicle_positions')
          .whereRaw('event_id = ?::uuid', [messageId])
          .count({ c: '*' })
          .first()
      )?.c ?? 0,
    );
    expect(count).toBe(1);
  });

  it('does not leak a position to a different tenant (tenant-scoped read)', async () => {
    const tenantId = '11111111-1111-1111-1111-111111111111';
    const tenantB = '22222222-2222-2222-2222-222222222222';
    const deviceId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    const messageId = 'abcdef01-1234-1234-1234-123456789abc';
    const event = parsePositionEnvelope(
      Buffer.from(
        JSON.stringify({
          messageId,
          deviceId,
          tenantId,
          timestamp: '2026-08-14T11:00:00.000Z',
          position: { latitude: 1, longitude: 2 },
        }),
      ),
    );
    await repo.insert(event);
    // Tenant B querying for the same vehicle sees nothing (no cross-tenant leak).
    const leaked = await repo.findLatest(tenantB, deviceId);
    expect(leaked).toBeNull();
    // The owning tenant can read it.
    const own = await repo.findLatest(tenantId, deviceId);
    expect(own?.tenantId).toBe(tenantId);
  });
});
