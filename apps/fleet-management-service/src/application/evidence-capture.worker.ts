/**
 * EvidenceCaptureWorker — D00 photo fetch + AB4 cabin window prime (F-07).
 *
 * Video "READY" means the unit answered AB4,OK: the 5+10s window is on its
 * SD card. AB4 is sent once that window has been recorded, and the unit then
 * plays it into MediaMTX. When the alarm has no photo yet (no snapshot from
 * the unit, or none uploaded) one frame of that playback is stored as the
 * alarm photo; a snapshot the unit uploads later still replaces it.
 */
import { Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import type { FrameGrabber } from '../infrastructure/face/face-client.js';
import {
  type EvidencePhotoCompression,
  compressEvidencePhoto,
} from '../infrastructure/media/evidence-photo-compressor.js';
import type { DeviceRepository } from '../infrastructure/persistence/device.repository.js';
import type {
  EvidenceCaptureRepository,
  EvidenceJob,
} from '../infrastructure/persistence/evidence-capture.repository.js';
import { type DeviceCommandService, mdvrChannelStreamPath } from './device-command.service.js';

const DEFAULT_CABIN_CHANNEL = 2;
/** How long the unit gets to start playing the clip after AB4. */
const CLIP_FRAME_WAIT_MS = 60_000;
const CLIP_FRAME_POLL_MS = 3_000;

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

export interface ClipFrameOptions {
  readonly frames: FrameGrabber;
  readonly devices: Pick<DeviceRepository, 'findById'>;
  /** MediaMTX RTSP base, e.g. rtsp://mediamtx:8554. */
  readonly rtspBaseUrl: string;
  /** MDVR stream root (MDVR_RTMP_PATH), e.g. live/md300. */
  readonly rtmpPath: string;
  readonly compression: EvidencePhotoCompression;
}

export interface EvidenceCaptureWorkerDeps {
  readonly evidence: EvidenceCaptureRepository;
  readonly commands: DeviceCommandService;
  readonly intervalMs: number;
  readonly batchSize: number;
  /** Absent when face-service is not configured: no clip frames then. */
  readonly clipFrames?: ClipFrameOptions | null;
  readonly sleep?: (ms: number) => Promise<void>;
}

export class EvidenceCaptureWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(EvidenceCaptureWorker.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  /** Devices playing an evidence clip: a second AB4 would cut the first one off. */
  private readonly playing = new Set<string>();

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
        const record = await this.deps.commands.create(
          this.systemActor(row.tenantId),
          row.deviceId,
          {
            commandCode: 'D00',
            params: { filename: row.photoName },
          },
        );
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
      if (this.playing.has(row.deviceId)) {
        await this.deps.evidence.releaseVideo(row.tenantId, row.id);
        continue;
      }
      try {
        if (!row.videoWindowFrom || !row.videoWindowTo) {
          await this.deps.evidence.markVideoFailed(row.tenantId, row.id, 'Missing video window');
          continue;
        }
        const channel = channelFromPhotoName(row.photoName, row.videoChannel);
        const record = await this.deps.commands.create(
          this.systemActor(row.tenantId),
          row.deviceId,
          {
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
          },
        );
        await this.deps.evidence.markVideoFetching(row.tenantId, row.id, record.id, channel);
        if (row.status !== 'PHOTO_READY' && this.deps.clipFrames) {
          this.playing.add(row.deviceId);
          void this.captureClipFrame(row, channel, this.deps.clipFrames)
            .catch((err: Error) =>
              this.logger.warn(`Clip frame failed for alert=${row.alertId}: ${err.message}`),
            )
            .finally(() => this.playing.delete(row.deviceId));
        }
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

  /** Store one frame of the AB4 playback as the alarm photo (if it still has none). */
  private async captureClipFrame(
    row: EvidenceJob,
    channel: number,
    opts: ClipFrameOptions,
  ): Promise<void> {
    const device = await opts.devices.findById(row.tenantId, row.deviceId);
    if (!device) return;
    const path = mdvrChannelStreamPath(opts.rtmpPath, channel, 'playback', device.imei);
    const base = opts.rtspBaseUrl.replace(/\/+$/, '');
    // The H.264 twin first (what the browser plays); the raw ingest if the
    // transcoder is not up yet.
    const urls = [`${base}/${path}_web`, `${base}/${path}`];
    const sleep = this.deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
    for (let waited = 0; waited < CLIP_FRAME_WAIT_MS; waited += CLIP_FRAME_POLL_MS) {
      await sleep(CLIP_FRAME_POLL_MS);
      for (const url of urls) {
        const frame = await opts.frames.grab(url).catch(() => null);
        if (!frame) continue;
        const bytes = await compressEvidencePhoto(frame, opts.compression);
        const stored = await this.deps.evidence.markClipFrame(row.tenantId, row.id, bytes);
        if (stored) {
          this.logger.log(`Alarm ${row.alertId}: photo taken from its clip (${path}).`);
        }
        return;
      }
    }
    this.logger.warn(`Alarm ${row.alertId}: clip ${path} never played — no clip frame.`);
  }
}
