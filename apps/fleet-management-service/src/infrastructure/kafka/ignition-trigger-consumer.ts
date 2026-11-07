/**
 * IgnitionTriggerConsumer — watches the gateway's raw position stream for an
 * ignition OFF → ON edge and asks DriverPhotoService for a cabin snapshot.
 *
 * Its own consumer group, so it never steals partitions from gps-engine. The
 * last ignition state per device lives in memory: after a restart the first
 * fix of each device only primes the state (no edge, no photo). Fixes older
 * than MAX_FIX_AGE_MS are ignored so a consumer lag or replay never photographs
 * an empty cab hours later.
 */
import { Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { type Consumer, type EachMessagePayload, Kafka } from 'kafkajs';
import type { DriverPhotoService } from '../../application/driver-photo.service.js';
import type { FleetManagementConfig } from '../../config/fleet-management.config.js';

interface PositionEnvelope {
  readonly deviceId?: string | null;
  readonly tenantId?: string | null;
  readonly timestamp?: string | null;
  readonly time?: string | null;
  readonly position?: { readonly ignitionOn?: boolean | null } | null;
}

const MAX_FIX_AGE_MS = 10 * 60_000;
/** Bound on remembered devices (each entry is a few bytes). */
const MAX_TRACKED_DEVICES = 200_000;

/** Pure edge detector — exported for unit tests. */
export class IgnitionEdgeTracker {
  private readonly last = new Map<string, boolean>();

  /** Feed one fix; true when this fix is an OFF → ON transition. */
  public feed(deviceId: string, ignitionOn: boolean | null | undefined): boolean {
    if (ignitionOn == null) return false;
    const prev = this.last.get(deviceId);
    if (this.last.size >= MAX_TRACKED_DEVICES && prev === undefined) this.last.clear();
    this.last.set(deviceId, ignitionOn);
    return prev === false && ignitionOn;
  }
}

export class IgnitionTriggerConsumer implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('IgnitionTriggerConsumer');
  private readonly edges = new IgnitionEdgeTracker();
  private consumer: Consumer | null = null;
  private started = false;
  private shutDown = false;
  private startAttempts = 0;

  constructor(
    private readonly config: FleetManagementConfig,
    private readonly driverPhotos: DriverPhotoService,
  ) {}

  public onApplicationBootstrap(): void {
    if (!this.config.FLEET_DRIVER_PHOTO_ENABLED) return;
    this.scheduleStart();
  }

  public async onApplicationShutdown(): Promise<void> {
    this.shutDown = true;
    if (!this.started) return;
    await this.consumer?.disconnect().catch(() => {
      /* best-effort */
    });
    this.consumer = null;
    this.started = false;
  }

  private scheduleStart(): void {
    void this.start().catch((err: Error) => {
      if (this.shutDown) return;
      this.startAttempts += 1;
      const backoffMs = Math.min(5_000 * 2 ** Math.min(this.startAttempts - 1, 4), 60_000);
      this.logger.warn(
        `Ignition consumer not started (attempt ${this.startAttempts}) — retrying in ${backoffMs}ms: ${err.message}`,
      );
      setTimeout(() => {
        if (!this.shutDown) this.scheduleStart();
      }, backoffMs).unref?.();
    });
  }

  private async start(): Promise<void> {
    if (this.started) return;
    const kafka = new Kafka({
      brokers: this.config.FLEET_KAFKA_BROKERS.split(','),
      clientId: this.config.FLEET_KAFKA_CLIENT_ID,
    });
    this.consumer = kafka.consumer({
      groupId: `${this.config.FLEET_KAFKA_GROUP_ID}-driver-photo`,
      sessionTimeout: 30_000,
      heartbeatInterval: 10_000,
    });
    await this.consumer.connect();
    await this.consumer.subscribe({
      topic: this.config.FLEET_KAFKA_POSITION_TOPIC,
      fromBeginning: false,
    });
    this.started = true;
    this.startAttempts = 0;
    this.logger.log(`Subscribed to ${this.config.FLEET_KAFKA_POSITION_TOPIC} for ignition edges.`);
    await this.consumer.run({ eachMessage: (p) => this.eachMessage(p) });
  }

  private async eachMessage(payload: EachMessagePayload): Promise<void> {
    let env: PositionEnvelope;
    try {
      env = JSON.parse(
        (payload.message.value ?? Buffer.alloc(0)).toString('utf8'),
      ) as PositionEnvelope;
    } catch {
      return;
    }
    const deviceId = env.deviceId;
    const tenantId = env.tenantId;
    if (!deviceId || !tenantId) return;
    if (!this.edges.feed(deviceId, env.position?.ignitionOn)) return;
    const at = new Date(env.timestamp ?? env.time ?? Date.now());
    const when = Number.isNaN(at.getTime()) ? new Date() : at;
    if (Date.now() - when.getTime() > MAX_FIX_AGE_MS) return;
    try {
      await this.driverPhotos.requestCapture(tenantId, deviceId, 'IGNITION', when);
    } catch (err) {
      this.logger.warn(
        `Driver photo request failed for device ${deviceId}: ${(err as Error).message}`,
      );
    }
  }
}
