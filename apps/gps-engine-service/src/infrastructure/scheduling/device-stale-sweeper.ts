/**
 * Device-stale sweeper — the ONLINE→STALE safety net (Sprint D §10).
 *
 * Normal path: the gateway emits DISCONNECTED and the device-status pipeline
 * projects OFFLINE. Failure path: the gateway CRASHES (or the network partitions)
 * — no DISCONNECTED is ever emitted, and the device stays ONLINE forever in
 * `tracking.device_status` (the Redis session entry TTL-expires on its own, but
 * nothing reconciles the DB row).
 *
 * This sweeper periodically transitions ONLINE devices whose `last_seen_at` is
 * older than GPS_STALE_AFTER_SECONDS to STALE (bounded batches; the throttled
 * per-position last-seen flush keeps streaming devices fresh, §9), and
 * broadcasts the STALE transitions so WS clients see the change. When the device
 * reconnects, the gateway's next lifecycle event re-ONLINEs it — the documented
 * recovery: gateway crashes → state expires → device reconnects → ONLINE again.
 */
import { Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import type { SignalBus } from '../../application/signal-bus.js';
import type { GpsEngineConfig } from '../../config/gps-engine.config.js';
import type { DeviceStatusRepository } from '../persistence/device-status.repository.js';

export class DeviceStaleSweeper implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(DeviceStaleSweeper.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly config: GpsEngineConfig,
    private readonly statusRepo: DeviceStatusRepository,
    private readonly signalBus: SignalBus,
  ) {}

  public onApplicationBootstrap(): void {
    const intervalMs = this.config.GPS_DEVICE_STALE_SWEEP_SECONDS * 1000;
    this.timer = setInterval(() => {
      this.sweep().catch((err) => this.logger.warn(`Sweep error: ${(err as Error).message}`));
    }, intervalMs);
    this.timer.unref?.();
    this.logger.log(
      `Device-stale sweeper started (every ${this.config.GPS_DEVICE_STALE_SWEEP_SECONDS}s, stale after ${this.config.GPS_STALE_AFTER_SECONDS}s).`,
    );
  }

  public onApplicationShutdown(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** One sweep pass — exposed for tests. Returns the transitioned records. */
  public async sweep(): Promise<number> {
    const transitioned = await this.statusRepo.markStale(this.config.GPS_STALE_AFTER_SECONDS);
    for (const record of transitioned) {
      this.signalBus.emitDeviceStatus(record);
    }
    if (transitioned.length > 0) {
      this.logger.log(`Marked ${transitioned.length} device(s) STALE (last_seen expired).`);
    }
    return transitioned.length;
  }
}
