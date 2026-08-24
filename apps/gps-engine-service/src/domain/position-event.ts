/**
 * PositionEvent — the canonical position parsed from the inbound CloudEvents
 * envelope (07 §3.1; the device-gateway's `telemetry.position.raw.v1`).
 *
 * This is the in-memory value the pipeline operates on. `quality` is assigned by
 * the validation gates; the other fields come straight from the wire (parsed by
 * the envelope parser). Immutable once constructed.
 *
 * NOTE: `vehicleId` carries the device-gateway's resolved `deviceId` for Sprint 7
 * (device→vehicle mapping lands with device-management-service in a later sprint).
 */
import type { Quality } from './quality.js';

export interface PositionEventProps {
  /** CloudEvents id / UUIDv7 — the idempotency key (dedupe on vehicleId+messageId). */
  readonly messageId: string;
  /** Entity key — the bound vehicle the position attributes to (binding-resolved). */
  readonly vehicleId: string;
  /** Source device id (envelope deviceId) — keys device_status last-seen.
   *  Optional for legacy constructors; falls back to vehicleId. */
  readonly deviceId?: string;
  readonly tenantId: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly speedKph: number;
  readonly headingDeg: number;
  readonly altitudeM: number | null;
  readonly satellites: number | null;
  readonly ignitionOn: boolean | null;
  /** Device-reported capture time (UTC). */
  readonly capturedAt: Date;
  /** Gateway ingest time. */
  readonly ingestedAt: Date;
  readonly protocolId: string;
  /** Assigned by the validation gates; defaults to VALID before validation. */
  readonly quality: Quality;
}

export class PositionEvent {
  public readonly messageId: string;
  public readonly vehicleId: string;
  public readonly deviceId: string;
  public readonly tenantId: string;
  public readonly latitude: number;
  public readonly longitude: number;
  public readonly speedKph: number;
  public readonly headingDeg: number;
  public readonly altitudeM: number | null;
  public readonly satellites: number | null;
  public readonly ignitionOn: boolean | null;
  public readonly capturedAt: Date;
  public readonly ingestedAt: Date;
  public readonly protocolId: string;
  public readonly quality: Quality;

  constructor(props: PositionEventProps) {
    this.messageId = props.messageId;
    this.vehicleId = props.vehicleId;
    this.deviceId = props.deviceId ?? props.vehicleId;
    this.tenantId = props.tenantId;
    this.latitude = props.latitude;
    this.longitude = props.longitude;
    this.speedKph = props.speedKph;
    this.headingDeg = props.headingDeg;
    this.altitudeM = props.altitudeM;
    this.satellites = props.satellites;
    this.ignitionOn = props.ignitionOn;
    this.capturedAt = props.capturedAt;
    this.ingestedAt = props.ingestedAt;
    this.protocolId = props.protocolId;
    this.quality = props.quality;
  }

  /** Return a copy with an updated quality (immutable update). */
  public withQuality(quality: Quality): PositionEvent {
    return new PositionEvent({ ...this, quality });
  }
}
