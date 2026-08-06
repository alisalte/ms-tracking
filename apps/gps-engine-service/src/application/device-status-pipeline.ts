/**
 * Device-status pipeline — projects the gateway's session-lifecycle events into
 * the online/offline/stale read model (06 §12.1, 07 §13).
 *
 *   upsert DB → cache Redis → broadcast signal
 *
 * Stateless beyond the repos; one event = one upsert. Mirrors the position
 * pipeline's shape for consistency.
 */
import { Logger } from '@nestjs/common';
import type { DeviceStatusRecord } from '../domain/device-status.js';
import type { RedisDeviceStatusCache } from '../infrastructure/cache/redis-device-status-cache.js';
import type { DeviceStatusRepository } from '../infrastructure/persistence/device-status.repository.js';
import type { SignalBus } from './signal-bus.js';

export interface DeviceStatusPipelineDeps {
  readonly statusRepo: DeviceStatusRepository;
  readonly statusCache: RedisDeviceStatusCache;
  readonly signalBus: SignalBus;
}

export class DeviceStatusPipeline {
  private readonly logger = new Logger('DeviceStatusPipeline');

  constructor(private readonly deps: DeviceStatusPipelineDeps) {}

  public async process(record: DeviceStatusRecord): Promise<void> {
    try {
      await this.deps.statusRepo.upsert(record);
    } catch (err) {
      this.logger.warn(
        `Device-status upsert failed for ${record.deviceId}: ${(err as Error).message}`,
      );
      throw err;
    }

    // Best-effort cache + broadcast.
    await this.deps.statusCache.setStatus(record);
    this.deps.signalBus.emitDeviceStatus(record);
  }
}
