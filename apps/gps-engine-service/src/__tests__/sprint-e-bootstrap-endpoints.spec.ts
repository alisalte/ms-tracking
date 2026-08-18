import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from '@jest/globals';

import { DeviceStatusController } from '../api/device-status.controller.js';
import { PositionsController } from '../api/positions.controller.js';
import { DeviceStatusRecord } from '../domain/device-status.js';

/**
 * Sprint E live-map bootstrap endpoints:
 *   GET /positions/latest      — latest position per vehicle, one query (no N+1)
 *   GET /devices/status        — connection state for every tenant device
 *
 * Both must be tenant-scoped from the verified principal (Sprint B INV-I02)
 * and bound the `limit` query (Sprint D §24 clamping convention).
 */

const TENANT_A = '11111111-1111-4111-8111-111111111111';

function makeStatusController() {
  const calls: Array<{ tenantId: string; limit: number }> = [];
  const repo = {
    listForTenant: async (tenantId: string, limit: number) => {
      calls.push({ tenantId, limit });
      return [
        new DeviceStatusRecord({
          deviceId: 'd1',
          tenantId,
          state: 'ONLINE',
          protocolId: 'gt06',
          reason: null,
          lastSeenAt: new Date('2026-08-15T00:00:00Z'),
        }),
      ];
    },
  };
  const cache = { getStatus: async () => null };
  return { controller: new DeviceStatusController(cache as never, repo as never), calls };
}

function makePositionsController() {
  const calls: Array<{ tenantId: string; limit: number }> = [];
  const repo = {
    findLatestForTenant: async (tenantId: string, limit: number) => {
      calls.push({ tenantId, limit });
      return [
        {
          vehicleId: 'v1',
          tenantId,
          latitude: 35.7,
          longitude: 51.4,
          speedKph: 42,
          headingDeg: 180,
          altitudeM: null,
          ignitionOn: true,
          capturedAt: new Date(),
          ingestedAt: new Date(),
          quality: 1,
        },
      ];
    },
  };
  const cache = { getLatest: async () => null };
  return {
    controller: new PositionsController(
      cache as never,
      repo as never,
      { HISTORY_MAX_RANGE_DAYS: 31 } as never,
      null as never,
    ),
    calls,
  };
}

describe('GET /devices/status (Sprint E device-status bootstrap)', () => {
  it('lists the tenant device statuses with the default limit', async () => {
    const { controller, calls } = makeStatusController();
    const rows = await controller.list(TENANT_A, undefined);
    expect(rows).toHaveLength(1);
    const first = rows[0];
    expect(first).toBeInstanceOf(DeviceStatusRecord);
    expect(first?.state).toBe('ONLINE');
    expect(calls).toEqual([{ tenantId: TENANT_A, limit: 1000 }]);
  });

  it('clamps a garbage limit to the default and a huge limit to the cap', async () => {
    const { controller, calls } = makeStatusController();
    await controller.list(TENANT_A, 'not-a-number');
    await controller.list(TENANT_A, '999999');
    await controller.list(TENANT_A, '0');
    expect(calls.map((c) => c.limit)).toEqual([1000, 5000, 1]);
  });
});

describe('GET /positions/latest (Sprint E latest-per-vehicle bootstrap)', () => {
  it('returns the latest position per vehicle for the tenant', async () => {
    const { controller, calls } = makePositionsController();
    const rows = await controller.latestForTenant(TENANT_A, undefined);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.vehicleId).toBe('v1');
    expect(calls).toEqual([{ tenantId: TENANT_A, limit: 500 }]);
  });

  it('clamps the limit into 1..2000', async () => {
    const { controller, calls } = makePositionsController();
    await controller.latestForTenant(TENANT_A, 'NaN');
    await controller.latestForTenant(TENANT_A, '50000');
    await controller.latestForTenant(TENANT_A, '-5');
    expect(calls.map((c) => c.limit)).toEqual([500, 2000, 1]);
  });
});

describe('Sprint E route ordering (static segments before params)', () => {
  it('declares /positions/latest before /positions/:vehicleId', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/api/positions.controller.ts'), 'utf8');
    const latestRoute = src.indexOf("@Get('latest')");
    const paramRoute = src.indexOf("@Get(':vehicleId')");
    expect(latestRoute).toBeGreaterThan(-1);
    expect(paramRoute).toBeGreaterThan(-1);
    expect(latestRoute).toBeLessThan(paramRoute);
  });

  it('declares /devices/status before /devices/:deviceId/status', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/api/device-status.controller.ts'), 'utf8');
    const listRoute = src.indexOf("@Get('status')");
    const paramRoute = src.indexOf("@Get(':deviceId/status')");
    expect(listRoute).toBeGreaterThan(-1);
    expect(paramRoute).toBeGreaterThan(-1);
    expect(listRoute).toBeLessThan(paramRoute);
  });
});
