import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { PositionPipeline } from '../application/position-pipeline.js';
import { type PositionSignal, SignalBus } from '../application/signal-bus.js';
import type { GpsEngineConfig } from '../config/gps-engine.config.js';
import { PositionEvent } from '../domain/position-event.js';
import type { LatestPosition } from '../infrastructure/persistence/position.repository.js';

const NOW = new Date('2026-08-06T10:00:00Z');

/** Minimal config slice the pipeline needs. */
function fakeConfig(): GpsEngineConfig {
  return {
    GPS_STALE_AFTER_SECONDS: 300,
    GPS_FUTURE_THRESHOLD_SECONDS: 60,
  } as unknown as GpsEngineConfig;
}

/** Fake position repository — records inserts, no DB. */
class FakePositionRepo {
  public readonly inserted: PositionEvent[] = [];
  async insert(e: PositionEvent): Promise<void> {
    this.inserted.push(e);
  }
  async exists(): Promise<boolean> {
    return false;
  }
}

/** Fake cache — records the last setLatest call. */
class FakeCache {
  public lastSet: PositionEvent | null = null;
  async setLatest(e: PositionEvent): Promise<void> {
    this.lastSet = e;
  }
  async getLatest(): Promise<LatestPosition | null> {
    return null;
  }
}

function buildEvent(
  opts: { messageId?: string; lat?: number; capturedAt?: Date } = {},
): PositionEvent {
  return new PositionEvent({
    messageId: opts.messageId ?? 'msg-001',
    vehicleId: 'dev-001',
    tenantId: 'tenant-001',
    latitude: opts.lat ?? 22.9,
    longitude: 113.4,
    speedKph: 42,
    headingDeg: 180,
    altitudeM: 55,
    satellites: 8,
    ignitionOn: true,
    capturedAt: opts.capturedAt ?? NOW,
    ingestedAt: NOW,
    protocolId: 'gt06',
    quality: 'VALID',
  });
}

/** Fake trip engine — a no-op (Sprint 8 tests exercise the FSMs separately). */
class FakeTripEngine {
  public readonly processed: PositionEvent[] = [];
  async process(e: PositionEvent): Promise<void> {
    this.processed.push(e);
  }
}

function buildPipeline() {
  const repo = new FakePositionRepo();
  const cache = new FakeCache();
  const signalBus = new SignalBus();
  const tripEngine = new FakeTripEngine();
  const pipeline = new PositionPipeline({
    config: fakeConfig(),
    positions: repo as never,
    cache: cache as never,
    signalBus,
    tripEngine: tripEngine as never,
  });
  return { pipeline, repo, cache, signalBus, tripEngine };
}

describe('PositionPipeline (07 §2, §3)', () => {
  beforeEach(() => {
    // Freeze "now" so freshness tests are deterministic.
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('persists, caches, and broadcasts a valid position', async () => {
    const { pipeline, repo, cache, signalBus } = buildPipeline();
    const signals: PositionSignal[] = [];
    signalBus.onPosition((s) => signals.push(s));

    const event = buildEvent({ capturedAt: new Date(NOW.getTime() - 5_000) }); // 5s ago
    await pipeline.process(event);

    expect(repo.inserted).toHaveLength(1);
    expect(repo.inserted[0]?.quality).toBe('VALID');
    expect(cache.lastSet?.messageId).toBe('msg-001');
    expect(signals).toHaveLength(1);
    expect(signals[0]?.latitude).toBe(22.9);
  });

  it('rejects an out-of-range position (no persist, no cache, no broadcast)', async () => {
    const { pipeline, repo, cache, signalBus } = buildPipeline();
    const signals: PositionSignal[] = [];
    signalBus.onPosition((s) => signals.push(s));

    await pipeline.process(buildEvent({ lat: 95 })); // invalid latitude

    expect(repo.inserted).toHaveLength(0);
    expect(cache.lastSet).toBeNull();
    expect(signals).toHaveLength(0);
  });

  it('persists a STALE position but does NOT cache or broadcast it', async () => {
    const { pipeline, repo, cache, signalBus } = buildPipeline();
    const signals: PositionSignal[] = [];
    signalBus.onPosition((s) => signals.push(s));

    const stale = buildEvent({ capturedAt: new Date(NOW.getTime() - 600_000) }); // 10min ago
    await pipeline.process(stale);

    expect(repo.inserted).toHaveLength(1);
    expect(repo.inserted[0]?.quality).toBe('STALE');
    expect(cache.lastSet).toBeNull();
    expect(signals).toHaveLength(0); // NOT broadcast (07 §3.4)
  });

  it('dedupes a replayed messageId (no double insert)', async () => {
    const { pipeline, repo } = buildPipeline();
    const event = buildEvent({ capturedAt: new Date(NOW.getTime() - 5_000) });

    await pipeline.process(event);
    await pipeline.process(event); // replay

    expect(repo.inserted).toHaveLength(1);
  });
});
