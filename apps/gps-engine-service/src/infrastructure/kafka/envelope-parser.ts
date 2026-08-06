import { DeviceStatusRecord, mapSessionState } from '../../domain/device-status.js';
/**
 * CloudEvents envelope parser — device-gateway JSON → domain objects.
 *
 * The gateway produces CloudEvents-aligned JSON (06 §13.2 `toEnvelope`) with
 * fields: specversion, type, time, id, messageId, deviceId, tenantId, protocolId,
 * messageType, timestamp, position{latitude, longitude, speedKph, headingDeg,
 * altitudeM, satellites, ignitionOn}, alarms, telemetry, io, rawSize, checksum.
 *
 * This module parses that JSON into the GPS engine's domain objects, validating
 * the presence of the fields the pipeline needs. Throws on a malformed envelope
 * so the consumer can route it to the DLQ / bump the error metric.
 */
import { PositionEvent } from '../../domain/position-event.js';

/** Raw envelope shape produced by the device-gateway (a subset we consume). */
interface PositionEnvelope {
  readonly messageId?: string;
  readonly id?: string;
  readonly deviceId?: string;
  readonly tenantId?: string;
  readonly protocolId?: string;
  readonly messageType?: string;
  readonly timestamp?: string;
  readonly time?: string;
  readonly position?: {
    readonly latitude?: number;
    readonly longitude?: number;
    readonly speedKph?: number;
    readonly headingDeg?: number;
    readonly altitudeM?: number | null;
    readonly satellites?: number | null;
    readonly ignitionOn?: boolean | null;
  };
}

/** Parse a CloudEvents JSON buffer/string into a PositionEvent (pre-quality). */
export function parsePositionEnvelope(raw: Buffer | string): PositionEvent {
  const env = JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf8')) as PositionEnvelope;
  const messageId = env.messageId ?? env.id;
  if (!messageId) throw new Error('envelope missing messageId/id');
  if (!env.deviceId) throw new Error('envelope missing deviceId');
  if (!env.tenantId) throw new Error('envelope missing tenantId');
  if (!env.position) throw new Error('envelope missing position');

  const pos = env.position;
  if (typeof pos.latitude !== 'number' || typeof pos.longitude !== 'number') {
    throw new Error('envelope position missing numeric latitude/longitude');
  }

  const capturedAt = env.timestamp ? new Date(env.timestamp) : new Date();
  const ingestedAt = env.time ? new Date(env.time) : new Date();

  return new PositionEvent({
    messageId,
    // Sprint 7: deviceId is the entity key (see position-event.ts doc).
    vehicleId: env.deviceId,
    tenantId: env.tenantId,
    latitude: pos.latitude,
    longitude: pos.longitude,
    speedKph: pos.speedKph ?? 0,
    headingDeg: pos.headingDeg ?? 0,
    altitudeM: pos.altitudeM ?? null,
    satellites: pos.satellites ?? null,
    ignitionOn: pos.ignitionOn ?? null,
    capturedAt,
    ingestedAt,
    protocolId: env.protocolId ?? '',
    quality: 'VALID',
  });
}

/** Raw session-lifecycle envelope shape (06 §13.2 publishSessionLifecycle). */
interface SessionEnvelope {
  readonly sessionId?: string;
  readonly deviceId?: string | null;
  readonly tenantId?: string | null;
  readonly state?: string;
  readonly reason?: string | null;
  readonly protocolId?: string;
  readonly time?: string;
}

/** Parse a session-lifecycle CloudEvents JSON into a DeviceStatusRecord. */
export function parseSessionEnvelope(raw: Buffer | string): DeviceStatusRecord {
  const env = JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf8')) as SessionEnvelope;
  if (!env.deviceId) throw new Error('session envelope missing deviceId');
  if (!env.tenantId) throw new Error('session envelope missing tenantId');
  if (!env.state) throw new Error('session envelope missing state');

  return new DeviceStatusRecord({
    deviceId: env.deviceId,
    tenantId: env.tenantId,
    state: mapSessionState(env.state),
    protocolId: env.protocolId ?? null,
    reason: env.reason ?? null,
    lastSeenAt: env.time ? new Date(env.time) : new Date(),
  });
}
