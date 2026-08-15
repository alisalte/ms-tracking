/**
 * Sprint G unit suite — AlarmEvaluatorService semantics against fakes:
 *
 *   1.  overspeed rule (no grace) raises one OPEN alarm
 *   2.  overspeed grace period requires sustained speeding
 *   3.  overspeed recovery auto-resolves the OPEN alarm (Part 14)
 *   4.  one-open-alarm dedup: a 10-minute speed run updates, never duplicates (Part 12)
 *   5.  geofence enter fires once on the inside transition (Part 15)
 *   6.  geofence duplicate prevention: staying inside fires nothing (Part 16)
 *   7.  geofence exit fires on the outside transition
 *   8.  device offline raises
 *   9.  device online auto-resolves the offline alarm (Part 17)
 *   10. rule disabled → never evaluated
 *   11. rule scope precedence: vehicle-scoped rule shadows tenant-wide (Part 9)
 *   12. tenant isolation: rules of tenant B never see tenant A signals (Part 25)
 */
import { describe, expect, it } from '@jest/globals';
import { AlarmEvaluatorService } from '../application/alarm-evaluator.service.js';
import type { InputSignal } from '../application/evaluators/rule-evaluator.js';
import type { AlarmOccurrence } from '../domain/alarm-occurrence.js';
import { AlarmRule } from '../domain/alarm-rule.js';
import type { AlarmStateCache } from '../infrastructure/cache/alarm-state-cache.js';
import type { AlarmOccurrenceRepository } from '../infrastructure/persistence/alarm-occurrence.repository.js';
import type { AlarmRuleRepository } from '../infrastructure/persistence/alarm-rule.repository.js';
import type { GeofenceQuery } from '../infrastructure/persistence/geofence-query.js';

const TENANT = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const TENANT_B = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const VEHICLE = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const VEHICLE_OTHER = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
const GEOFENCE = '11111111-2222-4333-8444-555555555555';

// ── Fakes ────────────────────────────────────────────────────────────────────

class FakeStateCache {
  public readonly sets = new Map<string, string>();
  public readonly eventIds = new Set<string>();
  public readonly overspeedSince = new Map<string, number>();
  public readonly occurrenceCounts = new Map<string, number>();

  public async shouldSuppress(
    tenantId: string,
    ruleId: string,
    vehicleId: string,
    ttlSec: number,
  ): Promise<boolean> {
    const key = `tenant:${tenantId}:alarm_dedup:${ruleId}:${vehicleId}`;
    if (this.sets.has(key)) return true; // within window
    this.sets.set(key, String(ttlSec));
    return false;
  }

  public async expireDedupWindow(): Promise<void> {
    this.sets.clear(); // simulate dedupWindowSec elapsing
  }

  public async isDuplicateEvent(tenantId: string, eventId: string): Promise<boolean> {
    const key = `${tenantId}:${eventId}`;
    if (this.eventIds.has(key)) return true;
    this.eventIds.add(key);
    return false;
  }

  public async getOverspeedSince(_t: string, ruleId: string, v: string): Promise<number | null> {
    return this.overspeedSince.get(`${ruleId}:${v}`) ?? null;
  }

  public async setOverspeedSince(_t: string, ruleId: string, v: string, sinceMs: number) {
    this.overspeedSince.set(`${ruleId}:${v}`, sinceMs);
  }

  public async clearOverspeedSince(_t: string, ruleId: string, v: string) {
    this.overspeedSince.delete(`${ruleId}:${v}`);
  }

  public async incrementOccurrenceCount(_t: string, ruleId: string, v: string) {
    const k = `${ruleId}:${v}`;
    const n = (this.occurrenceCounts.get(k) ?? 0) + 1;
    this.occurrenceCounts.set(k, n);
    return n;
  }

  public readonly geofenceState = new Map<string, Set<string>>();

  public async getGeofenceState(_t: string, v: string): Promise<Set<string>> {
    return this.geofenceState.get(v) ?? new Set();
  }

  public async setGeofenceState(_t: string, v: string, inside: Set<string>) {
    this.geofenceState.set(v, new Set(inside));
  }
}

class FakeAlarmsRepo {
  public readonly created: AlarmOccurrence[] = [];
  public readonly detailUpdates: Array<{ id: string; detail: Record<string, unknown> }> = [];
  public readonly statusUpdates: Array<{
    id: string;
    action: string;
    actor: string | null;
    reason?: string;
  }> = [];

  public async create(alarm: AlarmOccurrence): Promise<void> {
    this.created.push(alarm);
  }

  public async findOpenByRuleAndVehicle(
    _t: string,
    ruleId: string,
    vehicleId: string,
    type: string,
  ): Promise<AlarmOccurrence | null> {
    const found = [...this.created]
      .reverse()
      .find(
        (a) =>
          a.ruleId === ruleId &&
          a.vehicleId === vehicleId &&
          a.type === type &&
          a.status === 'OPEN',
      );
    return found ?? null;
  }

  public async updateDetail(alarm: AlarmOccurrence, detail: Record<string, unknown>) {
    this.detailUpdates.push({ id: alarm.id, detail });
    (alarm as { detail: Record<string, unknown> }).detail = detail;
    alarm.version += 1;
  }

  public async updateStatus(
    alarm: AlarmOccurrence,
    action: 'ACKNOWLEDGE' | 'RESOLVE',
    _prev: string,
    _next: string,
    actorId: string | null,
    reason?: string,
  ): Promise<void> {
    this.statusUpdates.push({ id: alarm.id, action, actor: actorId, reason });
  }
}

class FakeRulesRepo {
  public constructor(public rules: AlarmRule[] = []) {}
  public async listEnabled(tenantId: string): Promise<AlarmRule[]> {
    return this.rules.filter((r) => r.tenantId === tenantId && r.enabled);
  }
}

class FakeGeofenceQuery {
  public constructor(public inside: string[] = []) {}
  public async containsPoint(_t: string, _lat: number, _lng: number): Promise<string[]> {
    return this.inside;
  }
}

class FakeGateway {
  public readonly emitted: Array<{ event: string; tenantId: string; alarmId: string }> = [];
  public emitAlarmCreated(tenantId: string, alarm: AlarmOccurrence) {
    this.emitted.push({ event: 'alarm.created', tenantId, alarmId: alarm.id });
  }
  public emitAlarmAcknowledged(tenantId: string, alarm: AlarmOccurrence) {
    this.emitted.push({ event: 'alarm.acknowledged', tenantId, alarmId: alarm.id });
  }
  public emitAlarmResolved(tenantId: string, alarm: AlarmOccurrence) {
    this.emitted.push({ event: 'alarm.resolved', tenantId, alarmId: alarm.id });
  }
}

function makeHarness(rules: AlarmRule[], geofenceInside: string[] = []) {
  const stateCache = new FakeStateCache();
  const alarms = new FakeAlarmsRepo();
  const rulesRepo = new FakeRulesRepo(rules);
  const geofenceQuery = new FakeGeofenceQuery(geofenceInside);
  const gateway = new FakeGateway();
  const service = new AlarmEvaluatorService({
    rules: rulesRepo as unknown as AlarmRuleRepository,
    alarms: alarms as unknown as AlarmOccurrenceRepository,
    stateCache: stateCache as unknown as AlarmStateCache,
    geofenceQuery: geofenceQuery as unknown as GeofenceQuery,
    gateway: gateway as never,
    dispatcher: null,
    metrics: null,
  });
  return { service, stateCache, alarms, rulesRepo, geofenceQuery, gateway };
}

function makeRule(
  type: string,
  conditions: Record<string, unknown> = {},
  opts: { tenantId?: string; entityId?: string | null; enabled?: boolean } = {},
) {
  return AlarmRule.create(`rule-${type}-${opts.entityId ?? 'all'}`, {
    tenantId: opts.tenantId ?? TENANT,
    name: `${type} rule`,
    type: type as never,
    severity: 'HIGH',
    enabled: opts.enabled ?? true,
    entityType: 'vehicle',
    entityId: opts.entityId ?? null,
    conditions,
    cooldownSec: 300,
    dedupWindowSec: 600,
    repeatPolicy: 'COOLDOWN',
  });
}

function positionSignal(overrides: Partial<Extract<InputSignal, { kind: 'position' }>> = {}) {
  return {
    kind: 'position',
    tenantId: TENANT,
    vehicleId: VEHICLE,
    deviceId: 'dev-1',
    lat: 35.7,
    lng: 51.4,
    speedKph: 120,
    headingDeg: 0,
    capturedAt: '2026-01-01T00:10:00Z',
    ignitionOn: true,
    sourceEventId: 'msg-1',
    ...overrides,
  } satisfies Extract<InputSignal, { kind: 'position' }>;
}

// ── 1-4: overspeed ──────────────────────────────────────────────────────────

describe('Sprint G — overspeed detection + dedup + recovery', () => {
  it('1. raises ONE OPEN alarm when the limit is exceeded', async () => {
    const { service, alarms } = makeHarness([makeRule('overspeed', { thresholdKmh: 100 })]);
    await service.processPosition(positionSignal({ speedKph: 80 }));
    expect(alarms.created).toHaveLength(0); // below limit → no alarm
    await service.processPosition(positionSignal({ speedKph: 125 }));
    expect(alarms.created).toHaveLength(1);
    expect(alarms.created.at(0)?.type).toBe('overspeed');
    expect(alarms.created.at(0)?.status).toBe('OPEN');
  });

  it('2. grace period requires sustained speeding before raising', async () => {
    const { service, alarms } = makeHarness([
      makeRule('overspeed', { thresholdKmh: 100, gracePeriodSec: 120 }),
    ]);
    // First speeding packet opens the window — no alarm yet.
    await service.processPosition(
      positionSignal({ speedKph: 125, capturedAt: '2026-01-01T00:00:00Z', sourceEventId: 'm1' }),
    );
    expect(alarms.created).toHaveLength(0);
    // 60 s later — still inside grace.
    await service.processPosition(
      positionSignal({ speedKph: 125, capturedAt: '2026-01-01T00:01:00Z', sourceEventId: 'm2' }),
    );
    expect(alarms.created).toHaveLength(0);
    // 3 min of sustained speeding — grace satisfied.
    await service.processPosition(
      positionSignal({ speedKph: 125, capturedAt: '2026-01-01T00:03:10Z', sourceEventId: 'm3' }),
    );
    expect(alarms.created).toHaveLength(1);
  });

  it('3. recovery: speed back under the limit auto-resolves the OPEN alarm', async () => {
    const { service, alarms } = makeHarness([makeRule('overspeed', { thresholdKmh: 100 })]);
    await service.processPosition(positionSignal({ speedKph: 125, sourceEventId: 'm1' }));
    expect(alarms.created).toHaveLength(1);
    const id = alarms.created.at(0)?.id;
    await service.processPosition(positionSignal({ speedKph: 80, sourceEventId: 'm2' }));
    expect(alarms.created.at(0)?.status).toBe('RESOLVED');
    const resolve = alarms.statusUpdates.find((u) => u.id === id && u.action === 'RESOLVE');
    expect(resolve).toBeDefined();
    expect(resolve?.actor).toBeNull(); // system auto-resolve (null actor)
  });

  it('4. one-open dedup: a sustained speed run never duplicates the OPEN alarm', async () => {
    const { service, alarms, stateCache } = makeHarness([
      makeRule('overspeed', { thresholdKmh: 100 }),
    ]);
    for (let i = 0; i < 10; i++) {
      await service.processPosition(
        positionSignal({
          speedKph: 150,
          capturedAt: `2026-01-01T00:${String(i).padStart(2, '0')}:00Z`,
          sourceEventId: `m${i}`,
        }),
      );
    }
    expect(alarms.created).toHaveLength(1); // dedup window suppressed 9
    // After the window expires, still speeding → UPDATE the open alarm, not a new one.
    stateCache.expireDedupWindow();
    await service.processPosition(
      positionSignal({ speedKph: 150, capturedAt: '2026-01-01T00:30:00Z', sourceEventId: 'm30' }),
    );
    expect(alarms.created).toHaveLength(1);
    expect(alarms.detailUpdates).toHaveLength(1);
    expect(alarms.detailUpdates.at(0)?.detail.occurrenceCount as number).toBeGreaterThan(1);
  });
});

// ── 5-7: geofence ───────────────────────────────────────────────────────────

describe('Sprint G — geofence enter/exit (stateful)', () => {
  function harness() {
    const rules = [makeRule('geofence_enter', { geofenceId: GEOFENCE })];
    const h = makeHarness(rules, []);
    return h;
  }

  it('5. fires ONE enter when the vehicle transitions inside', async () => {
    const h = harness();
    await h.service.processPosition(positionSignal({ sourceEventId: 'm0' })); // outside
    h.geofenceQuery.inside = [GEOFENCE]; // now inside
    await h.service.processPosition(positionSignal({ sourceEventId: 'm1' }));
    expect(h.alarms.created).toHaveLength(1);
    expect(h.alarms.created.at(0)?.type).toBe('geofence_enter');
  });

  it('6. staying inside fires NOTHING (duplicate prevention)', async () => {
    const h = harness();
    h.geofenceQuery.inside = [GEOFENCE];
    for (let i = 0; i < 5; i++) {
      await h.service.processPosition(positionSignal({ sourceEventId: `m${i}` }));
    }
    expect(h.alarms.created).toHaveLength(1); // the single enter
  });

  it('7. exit fires on the inside→outside transition', async () => {
    const h = makeHarness([makeRule('geofence_exit', { geofenceId: GEOFENCE })], [GEOFENCE]);
    await h.service.processPosition(positionSignal({ sourceEventId: 'm0' })); // inside baseline
    expect(h.alarms.created).toHaveLength(0);
    h.geofenceQuery.inside = []; // left
    await h.service.processPosition(positionSignal({ sourceEventId: 'm1' }));
    expect(h.alarms.created).toHaveLength(1);
    expect(h.alarms.created.at(0)?.type).toBe('geofence_exit');
  });
});

// ── 8-9: device online/offline ──────────────────────────────────────────────

describe('Sprint G — device offline/online lifecycle', () => {
  it('8. device OFFLINE raises an alarm', async () => {
    const { service, alarms } = makeHarness([makeRule('device_offline')]);
    await service.processDeviceStatus({
      kind: 'device_status',
      tenantId: TENANT,
      vehicleId: VEHICLE,
      deviceId: VEHICLE,
      state: 'OFFLINE',
      lastSeenAt: '2026-01-01T00:00:00Z',
      sourceEventId: 's1',
    });
    expect(alarms.created).toHaveLength(1);
    expect(alarms.created.at(0)?.type).toBe('device_offline');
  });

  it('9. device ONLINE auto-resolves the open offline alarm', async () => {
    const { service, alarms } = makeHarness([makeRule('device_offline')]);
    await service.processDeviceStatus({
      kind: 'device_status',
      tenantId: TENANT,
      vehicleId: VEHICLE,
      deviceId: VEHICLE,
      state: 'OFFLINE',
      lastSeenAt: '2026-01-01T00:00:00Z',
      sourceEventId: 's1',
    });
    // Reconnect (a new ONLINE transition must not raise another alarm).
    await service.processDeviceStatus({
      kind: 'device_status',
      tenantId: TENANT,
      vehicleId: VEHICLE,
      deviceId: VEHICLE,
      state: 'ONLINE',
      lastSeenAt: '2026-01-01T00:05:00Z',
      sourceEventId: 's2',
    });
    expect(alarms.created).toHaveLength(1);
    expect(alarms.created.at(0)?.status).toBe('RESOLVED');
    // No alarm storm: a second ONLINE transition is a no-op.
    await service.processDeviceStatus({
      kind: 'device_status',
      tenantId: TENANT,
      vehicleId: VEHICLE,
      deviceId: VEHICLE,
      state: 'ONLINE',
      lastSeenAt: '2026-01-01T00:06:00Z',
      sourceEventId: 's3',
    });
    expect(alarms.created).toHaveLength(1);
    expect(alarms.statusUpdates).toHaveLength(1);
  });
});

// ── 10-12: rules / scoping / isolation ──────────────────────────────────────

describe('Sprint G — rule enablement, scope precedence, tenant isolation', () => {
  it('10. a disabled rule is never evaluated', async () => {
    const { service, alarms } = makeHarness([
      makeRule('overspeed', { thresholdKmh: 100 }, { enabled: false }),
    ]);
    await service.processPosition(positionSignal({ speedKph: 150 }));
    expect(alarms.created).toHaveLength(0);
  });

  it('11. a vehicle-scoped rule shadows the tenant-wide rule of the same type', async () => {
    const { service, alarms } = makeHarness([
      makeRule('overspeed', { thresholdKmh: 120 }, { entityId: null }),
      makeRule('overspeed', { thresholdKmh: 80 }, { entityId: VEHICLE }),
    ]);
    await service.processPosition(positionSignal({ speedKph: 100 }));
    // Only the vehicle-scoped rule (limit 80) evaluated — one alarm, not two.
    expect(alarms.created).toHaveLength(1);
    expect(alarms.created.at(0)?.message).toContain('80');
  });

  it('11b. tenant-wide rules still apply to other vehicles', async () => {
    const { service, alarms } = makeHarness([
      makeRule('overspeed', { thresholdKmh: 120 }, { entityId: null }),
      makeRule('overspeed', { thresholdKmh: 80 }, { entityId: VEHICLE }),
    ]);
    await service.processPosition(
      positionSignal({ vehicleId: VEHICLE_OTHER, speedKph: 125, sourceEventId: 'mo1' }),
    );
    expect(alarms.created).toHaveLength(1);
    expect(alarms.created.at(0)?.message).toContain('120');
  });

  it('12. tenant isolation: tenant-B rules never evaluate tenant-A signals', async () => {
    const { service, alarms } = makeHarness([
      makeRule('overspeed', { thresholdKmh: 100 }, { tenantId: TENANT_B }),
    ]);
    await service.processPosition(positionSignal({ speedKph: 150 }));
    expect(alarms.created).toHaveLength(0);
  });
});

// ── Trip/idle/parking wiring ────────────────────────────────────────────────

describe('Sprint G — FleetEvent-driven rules (trip/idle/parking)', () => {
  it('trip.started raises a trip_started alarm', async () => {
    const { service, alarms } = makeHarness([makeRule('trip_started')]);
    await service.processTrip({
      kind: 'trip',
      tenantId: TENANT,
      vehicleId: VEHICLE,
      type: 'trip.started',
      durationSec: 0,
      distanceKm: 0,
      startedAt: '2026-01-01T00:00:00Z',
      endedAt: '2026-01-01T00:00:00Z',
      sourceEventId: 'm1:trip.started',
    });
    expect(alarms.created).toHaveLength(1);
    expect(alarms.created.at(0)?.type).toBe('trip_started');
  });

  it('idle.ended meeting the threshold raises a prolonged_idle alarm', async () => {
    const { service, alarms } = makeHarness([makeRule('prolonged_idle', { minDurationSec: 900 })]);
    await service.processIdle({
      kind: 'idle',
      tenantId: TENANT,
      vehicleId: VEHICLE,
      type: 'idle.ended',
      startedAt: '2026-01-01T00:00:00Z',
      endedAt: '2026-01-01T00:20:00Z',
      durationSec: 1200,
      sourceEventId: 'm2:idle.ended',
    });
    expect(alarms.created).toHaveLength(1);
    expect(alarms.created.at(0)?.type).toBe('prolonged_idle');
  });

  it('parking.ended meeting the threshold raises a parking alarm', async () => {
    const { service, alarms } = makeHarness([makeRule('parking', { minDurationSec: 3600 })]);
    await service.processParking({
      kind: 'parking',
      tenantId: TENANT,
      vehicleId: VEHICLE,
      type: 'parking.ended',
      startedAt: '2026-01-01T00:00:00Z',
      endedAt: '2026-01-01T02:00:00Z',
      durationSec: 7200,
      sourceEventId: 'm3:parking.ended',
    });
    expect(alarms.created).toHaveLength(1);
    expect(alarms.created.at(0)?.type).toBe('parking');
  });
});
