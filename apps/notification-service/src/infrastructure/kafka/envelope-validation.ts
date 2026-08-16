/**
 * Consumer-boundary envelope validation + parsing (Sprint G Parts 4/21).
 *
 * Every Kafka payload entering the alarm engine passes through one of these
 * parsers. Structural failures throw `EventEnvelopeValidationError` — a
 * NON-RETRYABLE class (a malformed event will never parse; the consumer routes
 * it straight to the DLQ). A malformed event must never crash the consumer or
 * leak a NaN/undefined into rule evaluation.
 *
 * Trusted identity rules (Part 4): tenantId/vehicleId come from the
 * gateway/registry-sourced envelope only — never from client input. The
 * registry-sourced `vehicleId` (Sprint D §5) overrides the deviceId fallback,
 * mirroring gps-engine's envelope-parser semantics exactly.
 */
import type { InputSignal } from '../../application/evaluators/rule-evaluator.js';

/** Structural validation failure — non-retryable (route straight to DLQ). */
export class EventEnvelopeValidationError extends Error {
  public override readonly name = 'EventEnvelopeValidationError';
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new EventEnvelopeValidationError(`envelope ${field} missing/not-a-string`);
  }
  return value;
}

function parseTimestamp(value: unknown, field: string, fallback: string | null): string {
  if (value === undefined || value === null || value === '') {
    if (fallback !== null) return fallback;
    throw new EventEnvelopeValidationError(`envelope ${field} missing`);
  }
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new EventEnvelopeValidationError(`envelope ${field} not a string/number`);
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new EventEnvelopeValidationError(
      `envelope ${field} is not a valid date: ${String(value)}`,
    );
  }
  return d.toISOString();
}

function parseFiniteNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new EventEnvelopeValidationError(`envelope ${field} missing/not-a-finite-number`);
  }
  return value;
}

function parseEnvelopeObject(raw: Buffer): Record<string, unknown> {
  let env: unknown;
  try {
    env = JSON.parse(raw.toString('utf8'));
  } catch (err) {
    throw new EventEnvelopeValidationError(`envelope is not valid JSON: ${(err as Error).message}`);
  }
  if (env === null || typeof env !== 'object' || Array.isArray(env)) {
    throw new EventEnvelopeValidationError('envelope is not a JSON object');
  }
  return env as Record<string, unknown>;
}

/**
 * Parse a device-gateway position envelope (telemetry.position.raw.v1) into a
 * position InputSignal. Validates structure; rejects non-finite coordinates.
 */
export function parsePositionSignalEnvelope(raw: Buffer): InputSignal & { kind: 'position' } {
  const env = parseEnvelopeObject(raw);
  const position = env.position;
  if (position === null || typeof position !== 'object' || Array.isArray(position)) {
    throw new EventEnvelopeValidationError('envelope missing position object');
  }
  const pos = position as Record<string, unknown>;
  const lat = parseFiniteNumber(pos.latitude, 'position.latitude');
  const lng = parseFiniteNumber(pos.longitude, 'position.longitude');
  const deviceId = requireString(env.deviceId, 'deviceId');
  const tenantId = requireString(env.tenantId, 'tenantId');
  // Registry-sourced trusted vehicle identity (Sprint D §5) with the same
  // deviceId fallback gps-engine uses.
  const vehicleId =
    typeof env.vehicleId === 'string' && env.vehicleId.length > 0 ? env.vehicleId : deviceId;
  const ignition = pos.ignitionOn;
  return {
    kind: 'position',
    tenantId,
    vehicleId,
    deviceId,
    lat,
    lng,
    speedKph: typeof pos.speedKph === 'number' && Number.isFinite(pos.speedKph) ? pos.speedKph : 0,
    headingDeg:
      typeof pos.headingDeg === 'number' && Number.isFinite(pos.headingDeg) ? pos.headingDeg : 0,
    capturedAt: parseTimestamp(env.timestamp, 'timestamp', null),
    ignitionOn: typeof ignition === 'boolean' ? ignition : null,
    sourceEventId: typeof env.messageId === 'string' ? env.messageId : null,
  };
}

/**
 * Map a gateway session-lifecycle state onto the canonical device state —
 * mirrors gps-engine's mapSessionState (AUTHENTICATED/ACTIVE → ONLINE,
 * *STALE* → STALE, anything else → OFFLINE). Without this, the raw gateway
 * strings never matched the ONLINE check and device-recovery resolution
 * could never fire (Sprint G integration-test finding).
 */
function canonicalDeviceState(rawState: string): string {
  const upper = rawState.toUpperCase();
  if (upper === 'AUTHENTICATED' || upper === 'ACTIVE' || upper === 'IDENTIFY') return 'ONLINE';
  if (upper.includes('STALE')) return 'STALE';
  return 'OFFLINE';
}

/** Parse a session-lifecycle envelope (telemetry.session.lifecycle.v1). */
export function parseSessionSignalEnvelope(raw: Buffer): InputSignal & { kind: 'device_status' } {
  const env = parseEnvelopeObject(raw);
  const deviceId = requireString(env.deviceId, 'deviceId');
  const tenantId = requireString(env.tenantId, 'tenantId');
  const state = requireString(env.state, 'state');
  return {
    kind: 'device_status',
    tenantId,
    vehicleId: deviceId,
    deviceId,
    state: canonicalDeviceState(state),
    lastSeenAt: parseTimestamp(env.time, 'time', null),
    sourceEventId: typeof env.id === 'string' ? env.id : null,
  };
}

/** Map a FleetEvent eventType to its signal kind (null = not alarm-relevant). */
function trackingEventKind(eventType: string): InputSignal['kind'] | null {
  if (eventType === 'trip.started' || eventType === 'trip.ended') return 'trip';
  if (eventType === 'idle.started' || eventType === 'idle.ended' || eventType === 'idle.alert') {
    return 'idle';
  }
  if (
    eventType === 'parking.started' ||
    eventType === 'parking.ended' ||
    eventType === 'parking.tamper'
  ) {
    return 'parking';
  }
  if (
    eventType === 'geofence.entered' ||
    eventType === 'geofence.exited' ||
    eventType === 'geofence.dwell'
  ) {
    return 'geofence';
  }
  if (eventType.startsWith('device.')) return 'device_status';
  return null;
}

/**
 * Parse a gps-engine FleetEvent envelope (tracking.event.v1) into a typed
 * InputSignal. Required identity (Part 21): eventId, tenantId, vehicleId,
 * eventType, occurredAt. Malformed events throw (→ DLQ), never crash.
 * Returns null for structurally-valid event types the alarm engine does not
 * evaluate (forward-compatibility with new producers).
 */
export function parseTrackingEventEnvelope(raw: Buffer): InputSignal | null {
  const env = parseEnvelopeObject(raw);
  const eventType = requireString(env.eventType, 'eventType');
  const tenantId = requireString(env.tenantId, 'tenantId');
  const vehicleId = requireString(env.vehicleId, 'vehicleId');
  const occurredAt = parseTimestamp(env.occurredAt, 'occurredAt', null);
  const eventId = requireString(env.eventId ?? env.id, 'eventId');
  const kind = trackingEventKind(eventType);
  if (kind === null) {
    return null;
  }
  const metadata =
    env.metadata !== null && typeof env.metadata === 'object' && !Array.isArray(env.metadata)
      ? (env.metadata as Record<string, unknown>)
      : {};
  const num = (key: string, fallback: number): number =>
    typeof metadata[key] === 'number' && Number.isFinite(metadata[key])
      ? (metadata[key] as number)
      : fallback;
  const iso = (key: string): string | null =>
    typeof metadata[key] === 'string' ? (metadata[key] as string) : null;

  if (kind === 'trip') {
    return {
      kind: 'trip',
      tenantId,
      vehicleId,
      type: eventType,
      durationSec: num('durationSec', 0),
      distanceKm: num('distanceKm', 0),
      startedAt: iso('startedAt') ?? occurredAt,
      endedAt: occurredAt,
      sourceEventId: eventId,
    };
  }
  if (kind === 'idle') {
    return {
      kind: 'idle',
      tenantId,
      vehicleId,
      type: eventType as 'idle.started' | 'idle.ended' | 'idle.alert',
      startedAt: iso('startedAt'),
      endedAt: occurredAt,
      durationSec: num('durationSec', 0),
      sourceEventId: eventId,
    };
  }
  if (kind === 'parking') {
    return {
      kind: 'parking',
      tenantId,
      vehicleId,
      type: eventType as 'parking.started' | 'parking.ended' | 'parking.tamper',
      startedAt: iso('startedAt'),
      endedAt: occurredAt,
      durationSec: num('durationSec', 0),
      sourceEventId: eventId,
    };
  }
  if (kind === 'geofence') {
    // Sprint I — geofence membership FleetEvents from the gps-engine evaluator.
    // geofenceId is trusted metadata from the producer's spatial evaluation.
    const geofenceId =
      typeof metadata.geofenceId === 'string' && metadata.geofenceId.length > 0
        ? metadata.geofenceId
        : null;
    return {
      kind: 'geofence',
      tenantId,
      vehicleId,
      type: eventType as 'geofence.entered' | 'geofence.exited' | 'geofence.dwell',
      geofenceId,
      geofenceName: typeof metadata.geofenceName === 'string' ? metadata.geofenceName : null,
      dwellSec: metadata.dwellSec === null || metadata.dwellSec === undefined ? null : num('dwellSec', 0),
      occurredAt,
      lat: num('lat', Number.NaN),
      lng: num('lng', Number.NaN),
      sourceEventId: eventId,
    };
  }
  // device.online / device.offline / device.stale
  const state = eventType.slice('device.'.length).toUpperCase();
  return {
    kind: 'device_status',
    tenantId,
    vehicleId,
    deviceId: typeof env.deviceId === 'string' ? env.deviceId : vehicleId,
    state,
    lastSeenAt: occurredAt,
    sourceEventId: eventId,
  };
}
