import { describe, expect, it } from '@jest/globals';
import { DriverBehaviorService } from '../application/driver-behavior.service.js';
import type { DriverRepository } from '../infrastructure/persistence/driver.repository.js';
import type {
  DrivingBehaviorRepository,
  DrivingEventRecord,
} from '../infrastructure/persistence/driving-behavior.repository.js';

const TENANT = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const VEHICLE = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const ALI = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const REZA = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

const FROM = new Date('2026-09-01T00:00:00Z');
const TO = new Date('2026-09-11T00:00:00Z');

function event(
  type: DrivingEventRecord['type'],
  driverId: string | null,
  raisedAt: string,
): DrivingEventRecord {
  return {
    id: `${type}-${raisedAt}-${driverId}`,
    tenantId: TENANT,
    driverId,
    vehicleId: VEHICLE,
    type,
    severity: 'WARNING',
    sourceAlarmId: null,
    raisedAt: new Date(raisedAt),
    payload: {},
  };
}

function makeService(events: DrivingEventRecord[]) {
  const drivers = {
    findById: async (_t: string, id: string) =>
      id === ALI
        ? { firstName: 'Ali', lastName: 'Rezaei' }
        : id === REZA
          ? { firstName: 'Reza', lastName: 'Karimi' }
          : null,
  } as unknown as DriverRepository;
  const behavior = {
    listBehaviorSourceAlarms: async () => [],
    listEventsForVehicle: async (_t: string, _v: string, from: Date, to: Date) =>
      events.filter((e) => e.raisedAt >= from && e.raisedAt <= to),
  } as unknown as DrivingBehaviorRepository;
  return new DriverBehaviorService(drivers, behavior);
}

describe('getVehicleBehavior', () => {
  it('scores the vehicle over all events, attributed or not', async () => {
    const svc = makeService([
      event('HARSH_BRAKE', ALI, '2026-09-05T10:00:00Z'),
      event('SPEED_VIOLATION', REZA, '2026-09-06T10:00:00Z'),
      event('EXCESSIVE_IDLE', null, '2026-09-07T10:00:00Z'),
    ]);
    const view = await svc.getVehicleBehavior(TENANT, VEHICLE, FROM, TO);
    // 100 - 5 (brake) - 4 (speed) - 2 (idle)
    expect(view.score).toBe(89);
    expect(view.eventCount).toBe(3);
    expect(view.unattributedCount).toBe(1);
    expect(view.harshBrake).toBe(1);
    expect(view.speedViolation).toBe(1);
    expect(view.excessiveIdle).toBe(1);
    expect(view.needsAttention).toBe(false);
  });

  it('splits events per driver, lowest score first, with names', async () => {
    const svc = makeService([
      event('HARSH_BRAKE', ALI, '2026-09-05T10:00:00Z'),
      event('HARSH_BRAKE', ALI, '2026-09-05T11:00:00Z'),
      event('RAPID_ACCELERATION', REZA, '2026-09-06T10:00:00Z'),
    ]);
    const view = await svc.getVehicleBehavior(TENANT, VEHICLE, FROM, TO);
    expect(view.drivers.map((d) => d.driverId)).toEqual([ALI, REZA]);
    expect(view.drivers[0]).toMatchObject({
      firstName: 'Ali',
      lastName: 'Rezaei',
      score: 90,
      eventCount: 2,
      harshBrake: 2,
    });
    expect(view.drivers[1]?.score).toBe(97);
  });

  it('returns 100 with no events and no previous score', async () => {
    const view = await makeService([]).getVehicleBehavior(TENANT, VEHICLE, FROM, TO);
    expect(view.score).toBe(100);
    expect(view.eventCount).toBe(0);
    expect(view.previousScore).toBeNull();
    expect(view.delta).toBeNull();
    expect(view.drivers).toEqual([]);
  });

  it('computes delta against the equally long previous period', async () => {
    const svc = makeService([
      // previous period (2026-08-22 → 2026-09-01): one speed violation → 96
      event('SPEED_VIOLATION', ALI, '2026-08-25T10:00:00Z'),
      // current period: two harsh brakes → 90
      event('HARSH_BRAKE', ALI, '2026-09-05T10:00:00Z'),
      event('HARSH_BRAKE', ALI, '2026-09-05T11:00:00Z'),
    ]);
    const view = await svc.getVehicleBehavior(TENANT, VEHICLE, FROM, TO);
    expect(view.score).toBe(90);
    expect(view.previousScore).toBe(96);
    expect(view.delta).toBe(-6);
  });

  it('flags attention at or below the threshold', async () => {
    const events = Array.from({ length: 6 }, (_, i) =>
      event('HARSH_BRAKE', ALI, `2026-09-0${i + 2}T10:00:00Z`),
    );
    const view = await makeService(events).getVehicleBehavior(TENANT, VEHICLE, FROM, TO);
    expect(view.score).toBe(70);
    expect(view.needsAttention).toBe(true);
  });
});
