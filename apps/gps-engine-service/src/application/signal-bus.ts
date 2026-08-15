/**
 * Signal bus — the in-process internal signal bus (07 §11.3).
 *
 * Decouples the position pipeline (producer of signals) from the WebSocket
 * broadcaster (consumer of signals). The pipeline emits `position.update` /
 * `device.status` without knowing or caring whether a WS server is attached;
 * the realtime gateway subscribes and fans out to Socket.IO rooms.
 *
 * Sprint 7 uses a simple typed EventEmitter — synchronous, in-process. A later
 * sprint upgrades this to a Redis-backed pub/sub so multiple broadcaster pods
 * each receive every signal (the `@socket.io/redis-adapter` already handles the
 * Socket.IO fan-out; this bus is the upstream feed).
 */
import { EventEmitter } from 'node:events';
import type { DeviceStatusRecord } from '../domain/device-status.js';
import type { PositionEvent } from '../domain/position-event.js';

export interface PositionSignal {
  readonly tenantId: string;
  readonly vehicleId: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly speedKph: number;
  readonly headingDeg: number;
  readonly capturedAt: string;
  readonly quality: string;
}

export interface DeviceStatusSignal {
  readonly tenantId: string;
  readonly deviceId: string;
  readonly state: string;
  readonly lastSeenAt: string;
}

/** Trip/idle/parking/engine-hours boundary events (Sprint 8). */
export type TripSignal = import('../domain/trip/trip-types.js').TripBoundaryEvent;
export type IdleSignal = import('../domain/trip/trip-types.js').IdleEvent;
export type ParkingSignal = import('../domain/trip/trip-types.js').ParkingEvent;

export interface EngineHoursSignal {
  readonly type: 'engine.hours.accumulated';
  readonly vehicleId: string;
  readonly tenantId: string;
  readonly accumulatedSec: number;
  readonly at: Date;
}

export const SIGNAL = {
  POSITION: 'position.update',
  DEVICE_STATUS: 'device.status',
  TRIP: 'trip.event',
  IDLE: 'idle.event',
  PARKING: 'parking.event',
  ENGINE_HOURS: 'engine.hours',
} as const;

export class SignalBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    // Allow more than the default 10 listeners (one per WS room set + tests).
    this.emitter.setMaxListeners(50);
  }

  /** Emit a position-update signal to the bus (called by the pipeline). */
  public emitPosition(event: PositionEvent): void {
    const signal: PositionSignal = {
      tenantId: event.tenantId,
      vehicleId: event.vehicleId,
      latitude: event.latitude,
      longitude: event.longitude,
      speedKph: event.speedKph,
      headingDeg: event.headingDeg,
      capturedAt: event.capturedAt.toISOString(),
      quality: event.quality,
    };
    this.emitter.emit(SIGNAL.POSITION, signal);
  }

  /** Emit a device-status signal (called by the session-lifecycle handler). */
  public emitDeviceStatus(record: DeviceStatusRecord): void {
    const signal: DeviceStatusSignal = {
      tenantId: record.tenantId,
      deviceId: record.deviceId,
      state: record.state,
      lastSeenAt: record.lastSeenAt.toISOString(),
    };
    this.emitter.emit(SIGNAL.DEVICE_STATUS, signal);
  }

  public onPosition(listener: (signal: PositionSignal) => void): void {
    this.emitter.on(SIGNAL.POSITION, listener);
  }

  public onDeviceStatus(listener: (signal: DeviceStatusSignal) => void): () => void {
    this.emitter.on(SIGNAL.DEVICE_STATUS, listener);
    return () => this.emitter.removeListener(SIGNAL.DEVICE_STATUS, listener);
  }

  // --- Sprint 8: Trip / Idle / Parking / Engine-Hours signals ---

  public emitTrip(event: TripSignal): void {
    this.emitter.emit(SIGNAL.TRIP, event);
  }

  public emitIdle(event: IdleSignal): void {
    this.emitter.emit(SIGNAL.IDLE, event);
  }

  public emitParking(event: ParkingSignal): void {
    this.emitter.emit(SIGNAL.PARKING, event);
  }

  public emitEngineHours(signal: EngineHoursSignal): void {
    this.emitter.emit(SIGNAL.ENGINE_HOURS, signal);
  }

  public onTrip(listener: (event: TripSignal) => void): () => void {
    this.emitter.on(SIGNAL.TRIP, listener);
    return () => this.emitter.removeListener(SIGNAL.TRIP, listener);
  }

  public onIdle(listener: (event: IdleSignal) => void): () => void {
    this.emitter.on(SIGNAL.IDLE, listener);
    return () => this.emitter.removeListener(SIGNAL.IDLE, listener);
  }

  public onParking(listener: (event: ParkingSignal) => void): () => void {
    this.emitter.on(SIGNAL.PARKING, listener);
    return () => this.emitter.removeListener(SIGNAL.PARKING, listener);
  }

  public onEngineHours(listener: (signal: EngineHoursSignal) => void): () => void {
    this.emitter.on(SIGNAL.ENGINE_HOURS, listener);
    return () => this.emitter.removeListener(SIGNAL.ENGINE_HOURS, listener);
  }

  /** Remove all listeners (test cleanup / shutdown). */
  public close(): void {
    this.emitter.removeAllListeners();
  }
}
