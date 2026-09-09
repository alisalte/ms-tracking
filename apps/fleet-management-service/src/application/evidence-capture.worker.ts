/**
 * EvidenceCaptureWorker — D00 photo fetch + AB4 cabin window prime (F-07).
 *
 * Video "READY" means the platform recorded the exact 5+10s window and issued
 * AB4 so the clip is primed; durable MinIO object store is not enabled yet.
 */
import { Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import type { EvidenceCaptureRepository } from '../infrastructure/persistence/evidence-capture.repository.js';
import type { DeviceCommandService } from './device-command.service.js';

const DEFAULT_CABIN_CHANNEL = 2;

function toMdvrBcdUtc(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `${p(d.getUTCFullYear() % 100)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`
  );
}

function channelFromPhotoName(photoName: string | null, fallback: number | null): number {
  if (photoName) {
    const m = /_CH(\d+)_/i.exec(photoName);
    if (m?.[1]) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n >= 1 && n <= 64) return n;
    }
  }
  return fallback && fallback >= 1 ? fallback : DEFAULT_CABIN_CHANNEL;
}

export interface EvidenceCaptureWorkerDeps {
  readonly evidence: EvidenceCaptureRepository;
  readonly commands: DeviceCommandService;
  readonly intervalMs: number;
  readonly batchSize: number;
}

export class EvidenceCaptureWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(EvidenceCaptureWorker.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly deps: EvidenceCaptureWorkerDeps) {}

  public onApplicationBootstrap(): void {
    if (this.deps.intervalMs <= 0) {
      this.logger.log('Evidence capture worker disabled (FLEET_EVIDENCE_WORKER_INTERVAL_MS=0).');
      return;
    }
    this.timer = setInterval(() => {
      this.tick().catch((err) =>
        this.logger.error(`Evidence sweep failed: ${(err as Error).message}`),
      );
    }, this.deps.intervalMs);
    this.timer.unref();
    this.logger.log(`Evidence capture worker started (interval=${this.deps.intervalMs}ms).`);
  }

  public onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  public async tick(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const photos = await this.processPhotos();
      const videos = await this.processVideos();
      return photos + videos;
    } finally {
      this.running = false;
    }
  }

  private systemActor(tenantId: string) {
    return {
      tenantId,
      actorId: null as string | null,
      actorType: 'SYSTEM' as const,
      requestId: null as string | null,
      ipAddress: null as string | null,
      userAgent: null as string | null,
    };
  }

  private async processPhotos(): Promise<number> {
    const due = await this.deps.evidence.claimPending(this.deps.batchSize);
    for (const row of due) {
      try {
        if (!row.photoName) {
          await this.deps.evidence.markFailed(row.tenantId, row.id, 'Missing photoName');
          continue;
        }
        const record = await this.deps.commands.create(this.systemActor(row.tenantId), row.deviceId, {
          commandCode: 'D00',
          params: { filename: row.photoName },
        });
        await this.deps.evidence.markFetchingWithCommand(row.tenantId, row.id, record.id);
      } catch (err) {
        await this.deps.evidence.markFailed(
          row.tenantId,
          row.id,
          (err as Error)?.message ?? 'D00 enqueue failed',
        );
        this.logger.warn(`Evidence D00 failed for alert=${row.alertId}: ${(err as Error).message}`);
      }
    }
    return due.length;
  }

  private async processVideos(): Promise<number> {
    const due = await this.deps.evidence.claimVideoPending(this.deps.batchSize);
    for (const row of due) {
      try {
        if (!row.videoWindowFrom || !row.videoWindowTo) {
          await this.deps.evidence.markVideoFailed(row.tenantId, row.id, 'Missing video window');
          continue;
        }
        const channel = channelFromPhotoName(row.photoName, row.videoChannel);
        const record = await this.deps.commands.create(this.systemActor(row.tenantId), row.deviceId, {
          commandCode: 'AB4',
          params: {
            url: 'rtmp://placeholder/live/md300/pb', // rewritten by resolveMediaDialback
            channel,
            avType: '3',
            streamType: '0',
            capType: '0',
            startTime: toMdvrBcdUtc(row.videoWindowFrom),
            endTime: toMdvrBcdUtc(row.videoWindowTo),
          },
        });
        await this.deps.evidence.markVideoFetching(row.tenantId, row.id, record.id, channel);
      } catch (err) {
        await this.deps.evidence.markVideoFailed(
          row.tenantId,
          row.id,
          (err as Error)?.message ?? 'AB4 enqueue failed',
        );
        this.logger.warn(`Evidence AB4 failed for alert=${row.alertId}: ${(err as Error).message}`);
      }
    }
    return due.length;
  }
}
