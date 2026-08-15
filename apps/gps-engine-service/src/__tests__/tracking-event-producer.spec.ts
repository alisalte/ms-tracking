/**
 * Sprint G unit suite — TrackingEventProducer envelope semantics (gps-engine):
 *
 *   - deterministic eventId (`<sourceEventId>:<eventType>`) → idempotency
 *   - events reference telemetry (no Position duplication)
 *   - trip/idle/parking/device-status envelope shapes
 *   - signal-bus subscription fan-out
 */
import { describe, expect, it } from '@jest/globals';
import { SignalBus } from '../application/signal-bus.js';
import { TrackingEventProducer } from '../infrastructure/kafka/tracking-event-producer.js';

const TENANT = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const VEHICLE = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

function makeProducer(bus: SignalBus) {
  return new TrackingEventProducer({
    brokers: ['localhost:9092'],
    clientId: 'test',
    topic: 'fleetvision.tracking.events',
    signalBus: bus,
    metrics: null,
  });
}

describe('TrackingEventProducer.build*Envelope (no broker needed)', () => {
  const bus = new SignalBus();
  const producer = makeProducer(bus);

  it('builds a deterministic trip envelope (idempotency key)', () => {
    const env = producer.buildTripEnvelope({
      type: 'trip.started',
      vehicleId: VEHICLE,
      tenantId: TENANT,
      startLat: 35.7,
      startLng: 51.4,
      endLat: 35.8,
      endLng: 51.5,
      startedAt: new Date('2026-01-01T00:00:00Z'),
      endedAt: new Date('2026-01-01T00:10:00Z'),
      distanceKm: 12.5,
      durationSec: 600,
      maxSpeedKmh: 90,
      stopCount: 0,
      sourceEventId: 'pos-42',
    });
    expect(env.eventId).toBe('pos-42:trip.started');
    expect(env.id).toBe(env.eventId); // deterministic — redelivery yields the same id
    expect(env.type).toBe('tracking.event.v1');
    expect(env.tenantId).toBe(TENANT);
    expect(env.vehicleId).toBe(VEHICLE);
    expect(env.metadata.durationSec).toBe(600);
    expect(Object.keys(env)).not.toContain('position'); // no Position duplication
  });

  it('builds idle/parking envelopes with deterministic ids + severity', () => {
    const idle = producer.buildIdleEnvelope({
      type: 'idle.alert',
      vehicleId: VEHICLE,
      tenantId: TENANT,
      startedAt: new Date('2026-01-01T00:00:00Z'),
      endedAt: new Date('2026-01-01T00:20:00Z'),
      durationSec: 1200,
      sourceEventId: 'pos-43',
    });
    expect(idle.eventId).toBe('pos-43:idle.alert');
    expect(idle.severity).toBe('MEDIUM');

    const parking = producer.buildParkingEnvelope({
      type: 'parking.ended',
      vehicleId: VEHICLE,
      tenantId: TENANT,
      startedAt: null,
      endedAt: new Date('2026-01-01T06:00:00Z'),
      lat: 35.7,
      lng: 51.4,
      durationSec: 21_600,
      sourceEventId: 'pos-44',
    });
    expect(parking.eventId).toBe('pos-44:parking.ended');
    expect(parking.severity).toBe('INFO');
  });

  it('builds a device-status envelope with a stable per-transition id', () => {
    const env = producer.buildDeviceStatusEnvelope({
      tenantId: TENANT,
      deviceId: 'dev-1',
      state: 'STALE',
      lastSeenAt: '2026-01-01T00:05:00Z',
    });
    expect(env.eventType).toBe('device.stale');
    expect(env.eventId).toBe(`dev:dev-1:STALE:${Date.parse('2026-01-01T00:05:00Z') / 1000}`);
  });

  it('eventIdFor is deterministic for identical inputs', () => {
    expect(TrackingEventProducer.eventIdFor('m1', 'trip.started')).toBe(
      TrackingEventProducer.eventIdFor('m1', 'trip.started'),
    );
    expect(TrackingEventProducer.eventIdFor('m1', 'trip.started')).not.toBe(
      TrackingEventProducer.eventIdFor('m2', 'trip.started'),
    );
  });
});

describe('TrackingEventProducer signal-bus fan-out', () => {
  it('routes trip/idle/parking/device-status signals to publish (and unsubscribes cleanly)', async () => {
    const bus = new SignalBus();
    const producer = makeProducer(bus);
    producer.start();

    // Intercept publish (would otherwise hit a real broker) — verify routing.
    const published: Array<{ eventType: string; eventId: string }> = [];
    (
      producer as unknown as {
        publish: (e: { eventType: string; eventId: string }) => Promise<void>;
      }
    ).publish = async (e) => {
      published.push(e);
    };

    bus.emitTrip({
      type: 'trip.started',
      vehicleId: VEHICLE,
      tenantId: TENANT,
      startLat: 35.7,
      startLng: 51.4,
      endLat: 35.8,
      endLng: 51.5,
      startedAt: new Date('2026-01-01T00:00:00Z'),
      endedAt: new Date('2026-01-01T00:10:00Z'),
      distanceKm: 5,
      durationSec: 600,
      maxSpeedKmh: 60,
      stopCount: 0,
      sourceEventId: 'pos-1',
    });
    bus.emitIdle({
      type: 'idle.ended',
      vehicleId: VEHICLE,
      tenantId: TENANT,
      startedAt: null,
      endedAt: new Date('2026-01-01T01:00:00Z'),
      durationSec: 300,
      sourceEventId: 'pos-2',
    });
    bus.emitParking({
      type: 'parking.started',
      vehicleId: VEHICLE,
      tenantId: TENANT,
      startedAt: null,
      endedAt: new Date('2026-01-01T02:00:00Z'),
      lat: 35.7,
      lng: 51.4,
      durationSec: 0,
      sourceEventId: 'pos-3',
    });
    bus.emitDeviceStatus({
      deviceId: 'dev-1',
      tenantId: TENANT,
      state: 'STALE',
      protocolId: 'gt06',
      reason: 'sweeper',
      lastSeenAt: new Date('2026-01-01T03:00:00Z'),
    });
    // EventEmitter emits synchronously; publish is async — flush microtasks.
    await new Promise((r) => setImmediate(r));

    expect(published.map((e) => e.eventType)).toEqual([
      'trip.started',
      'idle.ended',
      'parking.started',
      'device.stale',
    ]);
    expect(published.map((e) => e.eventId)).toEqual([
      'pos-1:trip.started',
      'pos-2:idle.ended',
      'pos-3:parking.started',
      expect.stringMatching(/^dev:dev-1:STALE:\d+$/),
    ]);

    await producer.onApplicationShutdown();
    bus.close();
  });
});
