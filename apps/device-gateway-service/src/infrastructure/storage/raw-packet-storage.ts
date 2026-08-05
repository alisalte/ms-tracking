/**
 * RawPacketStorage — forensic integrity + best-effort raw retention (06 §10.3,
 * §13.4).
 *
 * Every DeviceMessage carries `checksum` (SHA-256 of the raw payload). This is
 * NOT the protocol CRC (transport integrity) — it is an application-level
 * fingerprint retained into Kafka + audit projections for forensic replay and
 * dispute resolution (06 §10.3). This module computes that fingerprint and
 * exposes an optional, non-blocking sink for the raw bytes (S3/MinIO in prod;
 * a no-op in Sprint 3). Failures here NEVER block publish to Kafka (06 §13.4 —
 * "optional sinks (best-effort, non-blocking)").
 */
import { createHash } from 'node:crypto';
import type { RawPacket } from '../../domain/raw-packet.js';

/** The raw-retention sink — receives (key, bytes) tuples. Best-effort by design. */
export interface RawRetentionSink {
  store(key: string, bytes: Buffer): Promise<void>;
}

/** A no-op sink (Sprint 3 default). Production wires an S3/MinIO sink later. */
export class NullRawRetentionSink implements RawRetentionSink {
  public async store(): Promise<void> {
    /* no-op — retention deferred to a later sprint (06 §13.4). */
  }
}

export interface RawPacketStorageOptions {
  readonly sink?: RawRetentionSink;
  /** When true, attempts retention; when false (default), only computes the checksum. */
  readonly retainRaw?: boolean;
}

export class RawPacketStorage {
  private readonly sink: RawRetentionSink;
  private readonly retainRaw: boolean;

  constructor(options: RawPacketStorageOptions = {}) {
    this.sink = options.sink ?? new NullRawRetentionSink();
    this.retainRaw = options.retainRaw ?? false;
  }

  /** Compute the SHA-256 forensic fingerprint of a raw payload (06 §10.3). */
  public fingerprint(payload: Buffer): string {
    return createHash('sha256').update(payload).digest('hex');
  }

  /**
   * Optionally retain a raw packet. Non-blocking by contract: a sink failure is
   * swallowed and logged at the call site, never thrown to the caller (06 §13.4).
   * Returns the retention key (or null if retention is disabled).
   */
  public async retain(
    packet: RawPacket,
    deviceId: string,
    messageId: string,
  ): Promise<string | null> {
    if (!this.retainRaw) return null;
    const key = `raw/${deviceId}/${messageId}.bin`;
    try {
      await this.sink.store(key, Buffer.from(packet.payload));
      return key;
    } catch {
      // Best-effort: never propagate (06 §13.4). Caller continues to publish.
      return null;
    }
  }
}
