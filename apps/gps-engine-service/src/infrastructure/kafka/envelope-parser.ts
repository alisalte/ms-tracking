import { DeviceStatusRecord, mapSessionState } from '../../domain/device-status.js';
/**
 * CloudEvents envelope parser — device-gateway JSON → domain objects.
 *
 * The gateway produces CloudEvents-aligned JSON (06 §13.2 `toEnvelope`) with
 * fields: specversion, type, time, id, messageId, correlationId, deviceId,
 * vehicleId, tenantId, protocolId, messageType, timestamp, position{latitude,
 * longitude, speedKph, headingDeg, altitudeM, satellites, ignitionOn}, alarms,
 * telemetry, io, rawSize, checksum.
 *
 * Sprint D §18/§22 hardening: this is the consumer-boundary validator. All
 * structural validation failures throw `EnvelopeValidationError` — a
 * NON-RETRYABLE class (a malformed event will never parse, so retrying is
 * pointless; the consumer routes it straight to the DLQ). Timestamps are
 * strictly validated (an unparseable date previously produced `Invalid Date`,
 * sailed through quality validation as NaN comparisons, and got persisted).
 *
 * The gateway's `vehicleId` is the REGISTRY-SOURCED trusted identity (Sprint D
 * §5); when absent (pre-Sprint-D producers), the parser falls back to deviceId
 * — the documented Sprint-7 semantic.
 */
import { PositionEvent } from '../../domain/position-event.js';

/** Structural validation failure — non-retryable (Sprint D §18). */
export class EnvelopeValidationError extends Error {
  public override readonly name = 'EnvelopeValidationError';
}

/** Raw envelope shape produced by the device-gateway (a subset we consume). */
interface PositionEnvelope {
  readonly messageId?: string;
  readonly id?: string;
  readonly deviceId?: string;
  readonly vehicleId?: string | null;
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

/** Require a string field (null/undefined/empty → EnvelopeValidationError). */
function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new EnvelopeValidationError(`envelope ${field} missing/not-a-string`);
  }
  return value;
}

/** Parse a timestamp field; unparseable/absent (when required) → error (§22). */
function parseTimestamp(value: unknown, field: string, fallback: Date | null): Date {
  if (value === undefined || value === null || value === '') {
    if (fallback) return fallback;
    throw new EnvelopeValidationError(`envelope ${field} missing`);
  }
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new EnvelopeValidationError(`envelope ${field} not a string/number`);
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new EnvelopeValidationError(`envelope ${field} is not a valid date: ${String(value)}`);
  }
  return d;
}

/** Parse a CloudEvents JSON buffer/string into a PositionEvent (pre-quality). */
export function parsePositionEnvelope(raw: Buffer | string): PositionEvent {
  let env: PositionEnvelope;
  try {
    env = JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf8')) as PositionEnvelope;
  } catch (err) {
    throw new EnvelopeValidationError(`envelope is not valid JSON: ${(err as Error).message}`);
  }
  if (env === null || typeof env !== 'object' || Array.isArray(env)) {
    throw new EnvelopeValidationError('envelope is not a JSON object');
  }

  const messageId = requireString(env.messageId ?? env.id, 'messageId/id');
  const deviceId = requireString(env.deviceId, 'deviceId');
  const tenantId = requireString(env.tenantId, 'tenantId');
  if (!env.position || typeof env.position !== 'object') {
    throw new EnvelopeValidationError('envelope missing position');
  }

  const pos = env.position;
  if (typeof pos.latitude !== 'number' || typeof pos.longitude !== 'number') {
    throw new EnvelopeValidationError('envelope position missing numeric latitude/longitude');
  }
  if (!Number.isFinite(pos.latitude) || !Number.isFinite(pos.longitude)) {
    throw new EnvelopeValidationError('envelope position latitude/longitude not finite');
  }

  // §22 — event time (device timestamp) and ingestion time (gateway `time`).
  // Never overwrite device event time with server time; both are stored.
  const capturedAt = parseTimestamp(env.timestamp, 'timestamp', null);
  const ingestedAt = parseTimestamp(env.time, 'time', new Date());

  return new PositionEvent({
    messageId,
    // The registry-sourced vehicleId (Sprint D §5) is the entity key; the raw
    // deviceId rides along to keep device_status last-seen fresh (D §9).
    vehicleId:
      typeof env.vehicleId === 'string' && env.vehicleId.length > 0 ? env.vehicleId : deviceId,
    deviceId,
    tenantId,
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
  let env: SessionEnvelope;
  try {
    env = JSON.parse(typeof raw === 'string' ? raw : raw.toString('utf8')) as SessionEnvelope;
  } catch (err) {
    throw new EnvelopeValidationError(
      `session envelope is not valid JSON: ${(err as Error).message}`,
    );
  }
  if (env === null || typeof env !== 'object' || Array.isArray(env)) {
    throw new EnvelopeValidationError('session envelope is not a JSON object');
  }
  const deviceId = requireString(env.deviceId, 'deviceId');
  const tenantId = requireString(env.tenantId, 'tenantId');
  const state = requireString(env.state, 'state');

  return new DeviceStatusRecord({
    deviceId,
    tenantId,
    state: mapSessionState(state),
    protocolId: env.protocolId ?? null,
    reason: env.reason ?? null,
    lastSeenAt: parseTimestamp(env.time, 'time', new Date()),
  });
}
