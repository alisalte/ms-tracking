import { describe, expect, it } from '@jest/globals';
import { PositionEvent } from '../domain/position-event.js';
import { LastCanMemory } from '../infrastructure/cache/last-can-memory.js';
import type { LatestPosition } from '../infrastructure/persistence/position.repository.js';

class FakeRedis {
  public store = new Map<string, string>();
  async set(key: string, value: string): Promise<string> {
    this.store.set(key, value);
    return 'OK';
  }
  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }
  async mget(...keys: string[]): Promise<Array<string | null>> {
    return keys.map((k) => this.store.get(k) ?? null);
  }
}

function event(at: string, can: Record<string, unknown> | null): PositionEvent {
  return new PositionEvent({
    messageId: `m-${at}`,
    vehicleId: 'veh-1',
    tenantId: 'ten-1',
    latitude: 35.7,
    longitude: 51.4,
    speedKph: 10,
    headingDeg: 0,
    altitudeM: null,
    satellites: null,
    ignitionOn: null,
    capturedAt: new Date(at),
    ingestedAt: new Date(at),
    protocolId: 'meitrack',
    quality: 'VALID',
    ...(can
      ? { metadata: { cce: { event: 35, paramIds: [], params: {}, can, status: { x: 1 } } } }
      : {}),
  });
}

describe('LastCanMemory', () => {
  it('carries the last CAN reading onto a CAN-less record', async () => {
    const memory = new LastCanMemory(new FakeRedis() as never);
    await memory.apply(event('2026-10-19T10:00:00Z', { present: true, ids: ['0x99'], rpm: 1200 }));
    const out = await memory.apply(event('2026-10-19T10:01:00Z', { present: false, ids: [] }));
    expect(out.metadata?.cce).toMatchObject({
      can: { present: false },
      status: { x: 1 },
      lastCan: { seenAt: '2026-10-19T10:00:00.000Z', rpm: 1200, ids: ['0x99'] },
    });
  });

  it('leaves a CAN-less record alone when nothing was remembered', async () => {
    const memory = new LastCanMemory(new FakeRedis() as never);
    const e = event('2026-10-19T10:01:00Z', { present: false, ids: [] });
    expect(await memory.apply(e)).toBe(e);
  });

  it('does not let an older backlog record replace a newer reading', async () => {
    const memory = new LastCanMemory(new FakeRedis() as never);
    await memory.apply(event('2026-10-19T10:05:00Z', { present: true, ids: ['0x99'], rpm: 900 }));
    await memory.apply(event('2026-10-19T10:00:00Z', { present: true, ids: ['0x99'], rpm: 100 }));
    const out = await memory.apply(event('2026-10-19T10:06:00Z', { present: false, ids: [] }));
    expect(out.metadata?.cce).toMatchObject({ lastCan: { rpm: 900 } });
  });

  it('returns the event unchanged when Redis fails', async () => {
    const broken = {
      get: async () => {
        throw new Error('down');
      },
      set: async () => 'OK',
    };
    const e = event('2026-10-19T10:01:00Z', { present: false, ids: [] });
    expect(await new LastCanMemory(broken as never).apply(e)).toBe(e);
  });
});

describe('LastCanMemory.attachLatest', () => {
  const latest = (
    can: Record<string, unknown>,
    lastCan?: Record<string, unknown>,
  ): LatestPosition =>
    ({
      vehicleId: 'veh-1',
      tenantId: 'ten-1',
      cce: { event: 35, paramIds: [], params: {}, can, ...(lastCan ? { lastCan } : {}) },
    }) as unknown as LatestPosition;

  it('attaches a reading the gateway stored for a record without a fix', async () => {
    const redis = new FakeRedis();
    redis.store.set(
      'tenant:ten-1:vehicle:veh-1:can',
      JSON.stringify({ seenAt: '2026-10-19T10:00:00.000Z', can: { present: true, rpm: 800 } }),
    );
    const [out] = await new LastCanMemory(redis as never).attachLatest([
      latest({ present: false, ids: [] }),
    ]);
    expect(out?.cce).toMatchObject({ lastCan: { seenAt: '2026-10-19T10:00:00.000Z', rpm: 800 } });
  });

  it('keeps a newer lastCan already on the record and ignores records that have CAN', async () => {
    const redis = new FakeRedis();
    redis.store.set(
      'tenant:ten-1:vehicle:veh-1:can',
      JSON.stringify({ seenAt: '2026-10-19T10:00:00.000Z', can: { present: true, rpm: 800 } }),
    );
    const memory = new LastCanMemory(redis as never);
    const newer = latest(
      { present: false, ids: [] },
      { seenAt: '2026-10-19T10:05:00.000Z', rpm: 900 },
    );
    const withCan = latest({ present: true, ids: ['0x99'] });
    const [a, b] = await memory.attachLatest([newer, withCan]);
    expect(a).toBe(newer);
    expect(b).toBe(withCan);
  });
});
