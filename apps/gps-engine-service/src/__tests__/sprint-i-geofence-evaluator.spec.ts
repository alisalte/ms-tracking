import type { TelemetryMetrics } from '@fleetvision/observability';
/**
 * GeofenceEvaluator unit tests (Sprint I §61 EVENTS 11–18).
 *
 * The spatial candidate query is faked (real PostGIS is exercised by the
 * sprint-i INTEGRATION spec); these tests pin the FSM semantics:
 * transitions, duplicate prevention, jitter confirmation, dwell, multiple
 * simultaneous geofences, restart-safety, and alert_on filtering.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { GeofenceEvaluator } from '../application/geofence-evaluator.js';
import type { GeofenceSignal, SignalBus } from '../application/signal-bus.js';
import type { PositionEvent } from '../domain/position-event.js';
import type { GeofenceCandidate } from '../infrastructure/persistence/geofence-definitions.repository.js';
import type {
  GeofenceStatePatch,
  GeofenceStateRepository,
  GeofenceStateRow,
} from '../infrastructure/persistence/geofence-state.repository.js';

const TENANT = '11111111-1111-4111-8111-111111111111';
const VEHICLE = '22222222-2222-4222-8222-222222222222';
const FENCE_A = '33333333-3333-4333-8333-333333333331';
const FENCE_B = '33333333-3333-4333-8333-333333333332';

/** Captured FSM state per geofence — doubles as the durable store. */
class FakeStateRepo {
  public store = new Map<string, GeofenceStatePatch>();
  public loadCalls = 0;
  async loadForVehicle(
    tenantId: string,
    vehicleId: string,
  ): Promise<Map<string, GeofenceStateRow>> {
    this.loadCalls += 1;
    const out = new Map<string, GeofenceStateRow>();
    for (const [key, patch] of this.store) {
      const [tid, vid, gid] = key.split('|') as [string, string, string];
      if (tid !== tenantId || vid !== vehicleId) continue;
      out.set(gid, {
        tenantId: tid,
        vehicleId: vid,
        geofenceId: gid,
        state: patch.state,
        confirmCount: patch.confirmCount,
        enteredAt: patch.enteredAt,
        dwellFiredAt: patch.dwellFiredAt,
        lastSeenAt: patch.lastSeenAt,
      });
    }
    return out;
  }
  async upsert(tenantId: string, vehicleId: string, geofenceId: string, patch: GeofenceStatePatch) {
    this.store.set(`${tenantId}|${vehicleId}|${geofenceId}`, patch);
  }
  async deleteForGeofence() {}
}

class FakeDefinitionsRepo {
  public constructor(
    /** geofenceId → current contains flag (null = fence gone/inactive). */
    public inside: Map<string, boolean | null>,
  ) {}
  async candidatesForPosition(
    _t: string,
    _v: string,
    _lat: number,
    _lng: number,
  ): Promise<GeofenceCandidate[]> {
    const out: GeofenceCandidate[] = [];
    for (const [id, contains] of this.inside) {
      if (contains === null) continue; // not ACTIVE / not in bbox
      out.push({
        id,
        name: `fence-${id.slice(-1)}`,
        type: 'CIRCLE',
        radiusM: 500,
        dwellSec: null,
        alertOn: ['ENTER', 'EXIT', 'DWELL'],
        contains,
      });
    }
    return out;
  }
  async exactContains(_t: string, geofenceId: string): Promise<boolean | null> {
    return this.inside.get(geofenceId) ?? null;
  }
}

class FakeBus {
  public signals: GeofenceSignal[] = [];
  emitGeofence(s: GeofenceSignal) {
    this.signals.push(s);
  }
}

function makeEvent(
  overrides: Partial<{ lat: number; lng: number; at: Date; messageId: string }> = {},
) {
  return {
    tenantId: TENANT,
    vehicleId: VEHICLE,
    deviceId: 'dev-1',
    messageId: overrides.messageId ?? `m-${Math.random().toString(36).slice(2, 8)}`,
    latitude: overrides.lat ?? 35.7,
    longitude: overrides.lng ?? 51.4,
    capturedAt: overrides.at ?? new Date('2026-01-01T00:00:00Z'),
    ingestedAt: new Date(),
    speedKph: 30,
    headingDeg: 0,
    altitudeM: null,
    accuracyM: null,
    odometerKm: null,
    ignitionOn: null,
    sessionId: null,
    quality: 'VALID',
    withQuality: () => {
      throw new Error('unused');
    },
  } as unknown as PositionEvent;
}

function makeHarness(opts: { confirmPoints?: number; dwellSeconds?: number } = {}) {
  const state = new FakeStateRepo();
  const definitions = new FakeDefinitionsRepo(new Map([[FENCE_A, false]]));
  const bus = new FakeBus();
  const metrics = {
    geofenceEvents: { inc: jest.fn() },
    geofenceEvalErrors: { inc: jest.fn() },
  } as unknown as TelemetryMetrics;
  const evaluator = new GeofenceEvaluator({
    config: {
      GEOFENCE_ENABLED: true,
      GEOFENCE_CONFIRMATION_POINTS: opts.confirmPoints ?? 2,
      GEOFENCE_DWELL_SECONDS: opts.dwellSeconds ?? 600,
      GEOFENCE_CANDIDATE_BUFFER_DEG: 0.05,
    } as never,
    definitions: definitions as never,
    state: state as unknown as GeofenceStateRepository,
    signalBus: bus as unknown as SignalBus,
    metrics,
  });
  return { evaluator, state, definitions, bus, metrics };
}

describe('GeofenceEvaluator — ENTER/EXIT semantics (§19/§20)', () => {
  it('11. OUTSIDE → INSIDE (2 contained observations) emits ONE geofence.entered', async () => {
    const h = makeHarness();
    definitionsSet(h, true);
    await h.evaluator.process(makeEvent({ messageId: 'm1' }));
    await h.evaluator.process(makeEvent({ messageId: 'm2' }));
    expect(h.bus.signals.filter((s) => s.type === 'geofence.entered')).toHaveLength(1);
    expect(h.bus.signals[0]?.geofenceId).toBe(FENCE_A);
    expect(h.bus.signals[0]?.sourceEventId).toBe('m2'); // confirming position
  });

  it('12. INSIDE → OUTSIDE (2 non-contained) emits ONE geofence.exited', async () => {
    const h = makeHarness();
    definitionsSet(h, true);
    await h.evaluator.process(makeEvent());
    await h.evaluator.process(makeEvent());
    definitionsSet(h, false);
    await h.evaluator.process(makeEvent());
    await h.evaluator.process(makeEvent());
    const exits = h.bus.signals.filter((s) => s.type === 'geofence.exited');
    expect(exits).toHaveLength(1);
  });

  it('13. repeated INSIDE points emit NO duplicate ENTER', async () => {
    const h = makeHarness();
    definitionsSet(h, true);
    for (let i = 0; i < 8; i++) await h.evaluator.process(makeEvent());
    expect(h.bus.signals.filter((s) => s.type === 'geofence.entered')).toHaveLength(1);
  });

  it('14. repeated OUTSIDE points emit NO duplicate EXIT', async () => {
    const h = makeHarness();
    definitionsSet(h, false);
    for (let i = 0; i < 8; i++) await h.evaluator.process(makeEvent());
    expect(h.bus.signals).toHaveLength(0);
  });
});

describe('GeofenceEvaluator — jitter protection (§21)', () => {
  it('15. alternating single noisy points never flip state (no flapping events)', async () => {
    const h = makeHarness();
    for (let i = 0; i < 12; i++) {
      definitionsSet(h, i % 2 === 0); // in, out, in, out…
      await h.evaluator.process(makeEvent());
    }
    expect(h.bus.signals).toHaveLength(0);
  });

  it('15b. one noisy OUT point during INSIDE does not exit; bounce-back emits nothing', async () => {
    const h = makeHarness();
    definitionsSet(h, true);
    await h.evaluator.process(makeEvent());
    await h.evaluator.process(makeEvent()); // ENTER
    definitionsSet(h, false);
    await h.evaluator.process(makeEvent()); // CANDIDATE_OUT (1/2)
    definitionsSet(h, true);
    await h.evaluator.process(makeEvent()); // bounce back INSIDE
    definitionsSet(h, true);
    await h.evaluator.process(makeEvent()); // still inside
    const enters = h.bus.signals.filter((s) => s.type === 'geofence.entered');
    const exits = h.bus.signals.filter((s) => s.type === 'geofence.exited');
    expect(enters).toHaveLength(1);
    expect(exits).toHaveLength(0);
  });

  it('15c. confirmPoints=1 enters/exits on single transitions', async () => {
    const h = makeHarness({ confirmPoints: 1 });
    definitionsSet(h, true);
    await h.evaluator.process(makeEvent());
    definitionsSet(h, false);
    await h.evaluator.process(makeEvent());
    expect(h.bus.signals.map((s) => s.type)).toEqual(['geofence.entered', 'geofence.exited']);
  });
});

describe('GeofenceEvaluator — DWELL (§22)', () => {
  it('16. dwell fires ONCE after the threshold, never per packet', async () => {
    const h = makeHarness({ dwellSeconds: 600 });
    definitionsSet(h, true);
    const t0 = new Date('2026-01-01T00:00:00Z');
    await h.evaluator.process(makeEvent({ at: t0 })); // CANDIDATE_IN
    await h.evaluator.process(makeEvent({ at: new Date(t0.getTime() + 60_000) })); // ENTER @ +1min
    await h.evaluator.process(makeEvent({ at: new Date(t0.getTime() + 300_000) })); // 4 min < 10 min
    expect(h.bus.signals.filter((s) => s.type === 'geofence.dwell')).toHaveLength(0);
    await h.evaluator.process(makeEvent({ at: new Date(t0.getTime() + 660_000) })); // 10 min ≥ threshold
    const dwells = h.bus.signals.filter((s) => s.type === 'geofence.dwell');
    expect(dwells).toHaveLength(1);
    expect(dwells[0]?.dwellSec).toBeGreaterThanOrEqual(600);
    for (let i = 0; i < 5; i++) {
      await h.evaluator.process(makeEvent({ at: new Date(t0.getTime() + 1200_000 + i * 60_000) }));
    }
    expect(h.bus.signals.filter((s) => s.type === 'geofence.dwell')).toHaveLength(1);
  });

  it('16b. dwell resets after EXIT + re-ENTER (new occupancy fires again)', async () => {
    const h = makeHarness({ dwellSeconds: 600 });
    definitionsSet(h, true);
    const t0 = new Date('2026-01-01T00:00:00Z');
    await h.evaluator.process(makeEvent({ at: t0 }));
    await h.evaluator.process(makeEvent({ at: new Date(t0.getTime() + 60_000) })); // ENTER
    await h.evaluator.process(makeEvent({ at: new Date(t0.getTime() + 700_000) })); // DWELL
    expect(h.bus.signals.filter((s) => s.type === 'geofence.dwell')).toHaveLength(1);
    definitionsSet(h, false);
    await h.evaluator.process(makeEvent({ at: new Date(t0.getTime() + 800_000) }));
    await h.evaluator.process(makeEvent({ at: new Date(t0.getTime() + 900_000) })); // EXIT
    definitionsSet(h, true);
    await h.evaluator.process(makeEvent({ at: new Date(t0.getTime() + 1000_000) }));
    await h.evaluator.process(makeEvent({ at: new Date(t0.getTime() + 1100_000) })); // re-ENTER
    await h.evaluator.process(makeEvent({ at: new Date(t0.getTime() + 2000_000) })); // new DWELL
    expect(h.bus.signals.filter((s) => s.type === 'geofence.dwell')).toHaveLength(2);
  });

  it('16c. geofence.dwell is suppressed when alert_on lacks DWELL', async () => {
    const h = makeHarness({ dwellSeconds: 600 });
    definitionsSet(h, true);
    const orig = h.definitions.candidatesForPosition.bind(h.definitions);
    h.definitions.candidatesForPosition = async (...args: Parameters<typeof orig>) => {
      const list = await orig(...(args as Parameters<typeof orig>));
      return list.map((c) => ({ ...c, alertOn: ['ENTER', 'EXIT'] }));
    };
    const t0 = new Date('2026-01-01T00:00:00Z');
    await h.evaluator.process(makeEvent({ at: t0 }));
    await h.evaluator.process(makeEvent({ at: new Date(t0.getTime() + 60_000) }));
    await h.evaluator.process(makeEvent({ at: new Date(t0.getTime() + 700_000) }));
    expect(h.bus.signals.filter((s) => s.type === 'geofence.dwell')).toHaveLength(0);
    expect(h.bus.signals.filter((s) => s.type === 'geofence.entered')).toHaveLength(1);
  });
});

describe('GeofenceEvaluator — multiple geofences (§24) + restart (§23)', () => {
  it('17. two fences transition independently in the same pass', async () => {
    const h = makeHarness();
    h.definitions.inside.set(FENCE_B, false);
    definitionsSet(h, true);
    await h.evaluator.process(makeEvent());
    await h.evaluator.process(makeEvent());
    h.definitions.inside.set(FENCE_B, true);
    await h.evaluator.process(makeEvent());
    await h.evaluator.process(makeEvent());
    const entered = h.bus.signals.filter((s) => s.type === 'geofence.entered');
    expect(entered.map((s) => s.geofenceId).sort()).toEqual([FENCE_A, FENCE_B].sort());
  });

  it('18. restart-safe: a NEW evaluator instance over the persisted state does not re-emit ENTER', async () => {
    const h = makeHarness();
    definitionsSet(h, true);
    await h.evaluator.process(makeEvent());
    await h.evaluator.process(makeEvent()); // ENTER
    // Simulate a worker restart: fresh evaluator, SAME state store.
    const h2 = makeHarness();
    h2.state.store = h.state.store;
    (h2.definitions as FakeDefinitionsRepo).inside = new Map(h.definitions.inside);
    for (let i = 0; i < 3; i++) await h2.evaluator.process(makeEvent());
    expect(h2.bus.signals).toHaveLength(0); // still INSIDE — nothing re-emitted
  });

  it('18b. deleted/deactivated fence resets state silently (no phantom EXIT)', async () => {
    const h = makeHarness();
    definitionsSet(h, true);
    await h.evaluator.process(makeEvent());
    await h.evaluator.process(makeEvent()); // ENTER
    h.definitions.inside.set(FENCE_A, null); // fence archived → outside candidates
    await h.evaluator.process(makeEvent());
    expect(h.bus.signals.filter((s) => s.type === 'geofence.exited')).toHaveLength(0);
    const state = h.state.store.get(`${TENANT}|${VEHICLE}|${FENCE_A}`);
    expect(state?.state).toBe('OUTSIDE');
  });

  it('evaluator failures never throw (pipeline protection) + count a metric', async () => {
    const h = makeHarness();
    h.definitions.candidatesForPosition = async () => {
      throw new Error('postgis down');
    };
    await expect(h.evaluator.process(makeEvent())).resolves.toBeUndefined();
    expect(h.metrics.geofenceEvalErrors.inc).toHaveBeenCalledTimes(1);
  });
});

function definitionsSet(h: ReturnType<typeof makeHarness>, contains: boolean) {
  h.definitions.inside.set(FENCE_A, contains);
}

beforeEach(() => {
  jest.clearAllMocks();
});
