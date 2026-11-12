import { describe, expect, it } from '@jest/globals';
import { SIGNAL, SignalBus } from '../application/signal-bus.js';
import { PositionEvent } from '../domain/position-event.js';
import { FmbIoMemory } from '../infrastructure/cache/fmb-io-memory.js';
import { parsePositionEnvelope } from '../infrastructure/kafka/envelope-parser.js';

const panel = {
  updatedAt: '2026-11-10T08:00:00.000Z',
  groups: {
    din: [{ id: 1, key: 'din1', group: 'din', value: true, at: '2026-11-10T08:00:00.000Z' }],
  },
};

function envelope(telemetry: unknown): string {
  return JSON.stringify({
    messageId: 'm1',
    deviceId: 'd1',
    tenantId: 't1',
    protocolId: 'teltonika',
    time: '2026-11-10T08:00:01Z',
    timestamp: '2026-11-10T08:00:00Z',
    position: { latitude: 54.6, longitude: 25.2, speedKph: 10, headingDeg: 0 },
    telemetry,
  });
}

describe('FMB I/O panel in the position envelope', () => {
  it('is kept on the position metadata', () => {
    const event = parsePositionEnvelope(envelope({ fmbIo: panel }));
    expect(event.metadata?.fmbIo).toEqual(panel);
  });

  it('ignores a malformed panel', () => {
    expect(parsePositionEnvelope(envelope({ fmbIo: 'nope' })).metadata).toBeUndefined();
    expect(parsePositionEnvelope(envelope({ fmbIo: { groups: [] } })).metadata).toBeUndefined();
  });

  it('is broadcast on the position signal', () => {
    const bus = new SignalBus();
    const seen: unknown[] = [];
    bus.onPosition((s) => seen.push(s));
    bus.emitPosition(parsePositionEnvelope(envelope({ fmbIo: panel })));
    expect(seen[0]).toMatchObject({ fmbIo: panel });
    expect(SIGNAL.POSITION).toBe('position.update');
  });

  it('PositionEvent type still accepts it as metadata', () => {
    expect(
      new PositionEvent({
        ...parsePositionEnvelope(envelope({})),
        metadata: { fmbIo: panel },
      }).metadata?.fmbIo,
    ).toEqual(panel);
  });
});

describe('FmbIoMemory', () => {
  const point = (id: number, group: string, at: string) =>
    JSON.stringify({ id, key: `k${id}`, group, value: id, at });

  it('rebuilds the grouped panel from the gateway hash', async () => {
    const redis = {
      hgetall: async (key: string) => {
        expect(key).toBe('tenant:t1:vehicle:v1:fmbio');
        return {
          '9': point(9, 'ain', '2026-11-10T08:00:05.000Z'),
          '1': point(1, 'din', '2026-11-10T08:00:00.000Z'),
          bad: '{not json',
        };
      },
    };
    const out = await new FmbIoMemory(redis as never).read('t1', 'v1');
    expect(out?.updatedAt).toBe('2026-11-10T08:00:05.000Z');
    expect(out?.groups.din?.map((p) => p.id)).toEqual([1]);
    expect(out?.groups.ain?.map((p) => p.id)).toEqual([9]);
  });

  it('returns null for an empty hash or a Redis failure', async () => {
    expect(await new FmbIoMemory({ hgetall: async () => ({}) } as never).read('t', 'v')).toBeNull();
    const down = {
      hgetall: async () => {
        throw new Error('down');
      },
    };
    expect(await new FmbIoMemory(down as never).read('t', 'v')).toBeNull();
  });
});

describe('FmbIoMemory connection ownership', () => {
  it('closes a connection it created for the gateway database on shutdown', async () => {
    let quit = 0;
    const redis = { quit: async () => void quit++, disconnect: () => undefined };
    await new FmbIoMemory(redis as never, true).onApplicationShutdown();
    expect(quit).toBe(1);
  });

  it('leaves the shared connection alone', async () => {
    let quit = 0;
    const redis = { quit: async () => void quit++, disconnect: () => undefined };
    await new FmbIoMemory(redis as never).onApplicationShutdown();
    expect(quit).toBe(0);
  });
});
