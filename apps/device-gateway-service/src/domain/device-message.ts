/**
 * Canonical DeviceMessage — the normalization target for every protocol (06 §9.2).
 *
 * Every adapter decodes its vendor-specific frames into this one shape; all
 * downstream code (dispatcher, Kafka producer, sinks) operates on DeviceMessage
 * and never sees vendor formats. Aligned to the `telemetry.position.raw.v1`
 * payload (06 §13).
 *
 * Idempotency: `messageId` (UUIDv7) is the dedupe key; consumers dedupe on
 * `(device_id, message_id)` (06 §8.4).
 */
import type { Direction } from './raw-packet.js';

/** Canonical message types — the union every adapter normalizes into (06 §9.2). */
export type MessageType =
  | 'LOGIN'
  | 'POSITION'
  | 'ALARM'
  | 'HEARTBEAT'
  | 'TELEMETRY'
  | 'COMMAND_ACK'
  | 'PHOTO';

/** A normalized GPS fix (06 §10.2). */
export interface Position {
  readonly latitude: number;
  readonly longitude: number;
  readonly speedKph: number;
  readonly headingDeg: number;
  readonly altitudeM: number | null;
  readonly satellites: number | null;
  readonly timestamp: Date;
  /** Ignition state where the protocol exposes it (Teltonika bit, GT06 IO, …). */
  readonly ignitionOn: boolean | null;
}

/** A normalized alarm/event (06 §10.2). `source` is the raw vendor code. */
export interface Alarm {
  readonly code: string;
  readonly source: string;
  readonly severity: 'INFO' | 'WARNING' | 'CRITICAL';
}

export interface DeviceMessageProps {
  /** UUIDv7 — idempotency key (06 §8.4). */
  readonly messageId: string;
  /** Resolved FleetVision device id (only known after auth — 06 §6.1 invariant). */
  readonly deviceId: string;
  /** Raw identifier from the wire (IMEI / serial / UID). */
  readonly serialOrImei: string;
  /** Resolved tenant (only known after auth). */
  readonly tenantId: string;
  readonly protocolId: string;
  readonly type: MessageType;
  /** Device-reported time (UTC). */
  readonly timestamp: Date;
  /** Gateway receive time. */
  readonly ingestedAt: Date;
  readonly position?: Position;
  readonly alarms?: Alarm[];
  /** rpm, fuel, temp, digital/analog IO, … (06 §10.2). */
  readonly telemetry?: Record<string, unknown>;
  /** Raw IO map retained for traceability. */
  readonly io?: Record<string, unknown>;
  readonly rawSize: number;
  /** SHA-256 of the raw payload — application-level forensic fingerprint (06 §10.3). */
  readonly checksum: string;
  readonly direction: Direction;
}

export class DeviceMessage {
  public readonly messageId: string;
  public readonly deviceId: string;
  public readonly serialOrImei: string;
  public readonly tenantId: string;
  public readonly protocolId: string;
  public readonly type: MessageType;
  public readonly timestamp: Date;
  public readonly ingestedAt: Date;
  public readonly position?: Position;
  public readonly alarms?: Alarm[];
  public readonly telemetry?: Record<string, unknown>;
  public readonly io?: Record<string, unknown>;
  public readonly rawSize: number;
  public readonly checksum: string;
  public readonly direction: Direction;

  constructor(props: DeviceMessageProps) {
    this.messageId = props.messageId;
    this.deviceId = props.deviceId;
    this.serialOrImei = props.serialOrImei;
    this.tenantId = props.tenantId;
    this.protocolId = props.protocolId;
    this.type = props.type;
    this.timestamp = props.timestamp;
    this.ingestedAt = props.ingestedAt;
    this.position = props.position;
    this.alarms = props.alarms;
    this.telemetry = props.telemetry;
    this.io = props.io;
    this.rawSize = props.rawSize;
    this.checksum = props.checksum;
    this.direction = props.direction;
  }
}
