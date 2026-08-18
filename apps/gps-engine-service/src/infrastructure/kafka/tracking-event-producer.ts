import type { TelemetryMetrics } from '@fleetvision/observability';
/**
 * TrackingEventProducer — Sprint G FleetEvent publisher.
 *
 * Bridges the in-process SignalBus (trip/idle/parking FSM boundary events +
 * device-status transitions) onto the `fleetvision.tracking.events` Kafka
 * topic as CloudEvents-aligned `tracking.event.v1` envelopes. This is the
 * Event stage of the Sprint G pipeline:
 *
 *   Telemetry → GPS Engine FSMs → FleetEvent → Kafka → Alarm Evaluation
 *
 * Design rules (SPRINT-G brief Parts 2/4/6):
 *   - Events reference telemetry; they do NOT duplicate the Position entity.
 *     Only event-specific metadata (duration, distance, state…) is carried.
 *   - eventId is DETERMINISTIC: `<sourceEventId>:<eventType>` (the triggering
 *     position's messageId + event type). A Kafka redelivery / FSM re-emission
 *     produces the same id, so downstream consumers can deduplicate. Device
 *     status transitions (no source position) use
 *     `<deviceId>:<state>:<epochSeconds>`.
 *   - Identity is the trusted server-side context (tenantId/vehicleId from the
 *     validated position pipeline / registry-sourced envelope) — never client
 *     input.
 *
 * Non-fatal at boot: connects lazily on the first publish; a broker outage
 * logs + counts an error metric and the signal is dropped (positions remain
 * durable in the hypertable; events are derived data). Keyed by vehicleId for
 * per-vehicle ordering, mirroring the gateway's per-device keying rule.
 */
import { Logger, type OnApplicationShutdown } from '@nestjs/common';
import { Kafka, type Message, type Producer } from 'kafkajs';
import type {
  DeviceStatusSignal,
  GeofenceSignal,
  IdleSignal,
  ParkingSignal,
  SignalBus,
  TripSignal,
} from '../../application/signal-bus.js';

/** FleetEvent envelope emitted on the tracking-events topic (Sprint G Part 21). */
export interface FleetEventEnvelope {
  readonly specversion: '1.0';
  readonly type: 'tracking.event.v1';
  readonly id: string;
  readonly eventId: string;
  readonly correlationId: string;
  readonly eventType: string;
  readonly tenantId: string;
  readonly vehicleId: string;
  readonly deviceId: string | null;
  readonly occurredAt: string;
  readonly severity: 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' | null;
  readonly metadata: Record<string, unknown>;
}

export interface TrackingEventProducerDeps {
  readonly brokers: readonly string[];
  readonly clientId: string;
  readonly topic: string;
  readonly signalBus: SignalBus;
  readonly metrics?: TelemetryMetrics | null;
}

export class TrackingEventProducer implements OnApplicationShutdown {
  private readonly logger = new Logger('TrackingEventProducer');
  private readonly kafka: Kafka;
  private producer: Producer | null = null;
  private connecting: Promise<Producer> | null = null;
  private connected = false;
  private shutDown = false;
  private unsubscribes: Array<() => void> = [];

  constructor(private readonly deps: TrackingEventProducerDeps) {
    this.kafka = new Kafka({
      brokers: [...deps.brokers],
      clientId: deps.clientId,
      connectionTimeout: 10_000,
      requestTimeout: 30_000,
      retry: { retries: 5, initialRetryTime: 300, maxRetryTime: 10_000 },
    });
  }

  /** Subscribe to the signal bus (idempotent — called once from the module). */
  public start(): void {
    const bus = this.deps.signalBus;
    this.unsubscribes.push(
      bus.onTrip((e) => void this.publishTrip(e)),
      bus.onIdle((e) => void this.publishIdle(e)),
      bus.onParking((e) => void this.publishParking(e)),
      bus.onDeviceStatus((s) => void this.publishDeviceStatus(s)),
      bus.onGeofence((s) => void this.publish(this.buildGeofenceEnvelope(s))),
    );
    this.logger.log(`FleetEvent publishing enabled — topic ${this.deps.topic}`);
  }

  public async onApplicationShutdown(): Promise<void> {
    this.shutDown = true;
    for (const off of this.unsubscribes) off();
    this.unsubscribes = [];
    if (this.producer && this.connected) {
      await this.producer.disconnect().catch(() => {});
    }
    this.connected = false;
    this.producer = null;
  }

  /** Deterministic eventId — Part 6 idempotency requirement. */
  public static eventIdFor(sourceEventId: string | null | undefined, eventType: string): string {
    return `${sourceEventId ?? 'unknown'}:${eventType}`;
  }

  /** Build the envelope without publishing (unit-testable, no broker). */
  public buildTripEnvelope(e: TripSignal): FleetEventEnvelope {
    const source = e.sourceEventId ?? null;
    return {
      specversion: '1.0',
      type: 'tracking.event.v1',
      id: TrackingEventProducer.eventIdFor(source, e.type),
      eventId: TrackingEventProducer.eventIdFor(source, e.type),
      correlationId: source ?? e.vehicleId,
      eventType: e.type,
      tenantId: e.tenantId,
      vehicleId: e.vehicleId,
      deviceId: null,
      occurredAt: e.endedAt.toISOString(),
      severity: null,
      metadata: {
        sourceEventId: source,
        startedAt: e.startedAt?.toISOString() ?? null,
        distanceKm: e.distanceKm,
        durationSec: e.durationSec,
        maxSpeedKmh: e.maxSpeedKmh,
        stopCount: e.stopCount,
        startLat: e.startLat,
        startLng: e.startLng,
        endLat: e.endLat,
        endLng: e.endLng,
      },
    };
  }

  public buildIdleEnvelope(e: IdleSignal): FleetEventEnvelope {
    const source = e.sourceEventId ?? null;
    return {
      specversion: '1.0',
      type: 'tracking.event.v1',
      id: TrackingEventProducer.eventIdFor(source, e.type),
      eventId: TrackingEventProducer.eventIdFor(source, e.type),
      correlationId: source ?? e.vehicleId,
      eventType: e.type,
      tenantId: e.tenantId,
      vehicleId: e.vehicleId,
      deviceId: null,
      occurredAt: e.endedAt.toISOString(),
      severity: e.type === 'idle.alert' ? 'MEDIUM' : 'INFO',
      metadata: {
        sourceEventId: source,
        startedAt: e.startedAt?.toISOString() ?? null,
        durationSec: e.durationSec,
      },
    };
  }

  public buildParkingEnvelope(e: ParkingSignal): FleetEventEnvelope {
    const source = e.sourceEventId ?? null;
    return {
      specversion: '1.0',
      type: 'tracking.event.v1',
      id: TrackingEventProducer.eventIdFor(source, e.type),
      eventId: TrackingEventProducer.eventIdFor(source, e.type),
      correlationId: source ?? e.vehicleId,
      eventType: e.type,
      tenantId: e.tenantId,
      vehicleId: e.vehicleId,
      deviceId: null,
      occurredAt: e.endedAt.toISOString(),
      severity: e.type === 'parking.tamper' ? 'HIGH' : 'INFO',
      metadata: {
        sourceEventId: source,
        startedAt: e.startedAt?.toISOString() ?? null,
        durationSec: e.durationSec,
        lat: e.lat,
        lng: e.lng,
      },
    };
  }

  public buildDeviceStatusEnvelope(s: DeviceStatusSignal): FleetEventEnvelope {
    const epochSec = Math.floor(new Date(s.lastSeenAt).getTime() / 1000);
    const id = `dev:${s.deviceId}:${s.state}:${epochSec}`;
    return {
      specversion: '1.0',
      type: 'tracking.event.v1',
      id,
      eventId: id,
      correlationId: id,
      eventType: `device.${s.state.toLowerCase()}`,
      tenantId: s.tenantId,
      vehicleId: s.deviceId, // device-keyed; alarm engine resolves via rule entity
      deviceId: s.deviceId,
      occurredAt: s.lastSeenAt,
      severity: s.state === 'ONLINE' ? 'INFO' : 'MEDIUM',
      metadata: { state: s.state, lastSeenAt: s.lastSeenAt },
    };
  }

  /**
   * Sprint I — geofence membership event envelope. Deterministic eventId
   * `<sourceEventId>:<eventType>:<geofenceId>`: a Kafka redelivery or an
   * evaluator re-emission produces the same id so the alarm engine +
   * fleet_events store can deduplicate (duplicate-safe by construction).
   */
  public buildGeofenceEnvelope(s: GeofenceSignal): FleetEventEnvelope {
    const eventId = `${s.sourceEventId ?? 'unknown'}:${s.type}:${s.geofenceId}`;
    return {
      specversion: '1.0',
      type: 'tracking.event.v1',
      id: eventId,
      eventId,
      correlationId: s.sourceEventId ?? s.vehicleId,
      eventType: s.type,
      tenantId: s.tenantId,
      vehicleId: s.vehicleId,
      deviceId: null,
      occurredAt: s.occurredAt,
      severity:
        s.type === 'geofence.exited' ? 'LOW' : s.type === 'geofence.dwell' ? 'MEDIUM' : 'INFO',
      metadata: {
        sourceEventId: s.sourceEventId,
        geofenceId: s.geofenceId,
        geofenceName: s.geofenceName,
        dwellSec: s.dwellSec,
        lat: s.lat,
        lng: s.lng,
      },
    };
  }

  // ── publish helpers (lazy connect, best-effort, metric-counted) ──

  private async publishTrip(e: TripSignal): Promise<void> {
    await this.publish(this.buildTripEnvelope(e));
  }

  private async publishIdle(e: IdleSignal): Promise<void> {
    await this.publish(this.buildIdleEnvelope(e));
  }

  private async publishParking(e: ParkingSignal): Promise<void> {
    await this.publish(this.buildParkingEnvelope(e));
  }

  private async publishDeviceStatus(s: DeviceStatusSignal): Promise<void> {
    await this.publish(this.buildDeviceStatusEnvelope(s));
  }

  private async publish(envelope: FleetEventEnvelope): Promise<void> {
    if (this.shutDown) return;
    try {
      const producer = await this.connect();
      const record: Message = {
        key: envelope.vehicleId,
        value: JSON.stringify(envelope),
        headers: {
          'event-type': envelope.type,
          'event-id': envelope.eventId,
          'event-name': envelope.eventType,
          'tenant-id': envelope.tenantId,
          'vehicle-id': envelope.vehicleId,
        },
      };
      await producer.send({ topic: this.deps.topic, messages: [record] });
      this.deps.metrics?.kafkaProduced.inc({ topic: 'tracking', result: 'ok' });
    } catch (err) {
      // Derived data — drop + count. Positions/trips stay durable in PG.
      this.deps.metrics?.kafkaProduced.inc({ topic: 'tracking', result: 'error' });
      this.logger.warn(
        `Failed to publish FleetEvent ${envelope.eventType} for vehicle ${envelope.vehicleId}: ${(err as Error).message}`,
      );
    }
  }

  private async connect(): Promise<Producer> {
    if (this.connected && this.producer) return this.producer;
    if (this.connecting) return this.connecting;
    this.connecting = (async () => {
      const producer = this.kafka.producer({ idempotent: true, allowAutoTopicCreation: false });
      producer.on(producer.events.CONNECT, () => {
        this.connected = true;
      });
      producer.on(producer.events.DISCONNECT, () => {
        this.connected = false;
      });
      await producer.connect();
      this.producer = producer;
      this.connected = true;
      this.logger.log('Tracking-event producer connected.');
      return producer;
    })();
    try {
      return await this.connecting;
    } finally {
      this.connecting = null;
    }
  }
}
