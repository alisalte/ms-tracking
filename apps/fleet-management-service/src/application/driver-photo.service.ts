/**
 * DriverPhotoService — cabin snapshot → driver of the shift.
 *
 *   trigger (ignition on / MDVR connect / operator)
 *     → PENDING      wait `delaySeconds` so the driver is seated
 *     → CAPTURING    AB2 starts the cabin camera's live stream (unless it is
 *                    already live); face-service grabs one frame from MediaMTX;
 *                    AB3 stops the stream again if we started it
 *     → READY        photo stored; face-service embeds it
 *
 * The MD300 answers the D03/D00 photo commands with `FFFE` (not supported), so
 * the snapshot is a frame of the live stream instead. `file_name` holds the
 * MediaMTX stream path the frame came from.
 *     → matched      AUTO when the face clearly matches one driver's confirmed photos
 *
 * Operators file photos by hand (CONFIRMED); every confirmed photo with a face
 * becomes a reference, and recent unfiled photos are re-matched against it.
 * Reporting credits the driver of an AUTO/CONFIRMED photo with that shift.
 */
import {
  BadRequestException,
  Logger,
  NotFoundException,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import {
  type DriverMatchStatus,
  type DriverPhotoTrigger,
  MAX_DRIVER_PHOTO_ATTEMPTS,
  matchFace,
  retryDelaySeconds,
} from '../domain/driver-photo.js';
import type { FaceEmbedder, FrameGrabber } from '../infrastructure/face/face-client.js';
import type { DeviceCommandRepository } from '../infrastructure/persistence/device-command.repository.js';
import type { DeviceRepository } from '../infrastructure/persistence/device.repository.js';
import type {
  DriverPhotoCounts,
  DriverPhotoJob,
  DriverPhotoRepository,
  DriverPhotoView,
} from '../infrastructure/persistence/driver-photo.repository.js';
import { type DeviceCommandService, mdvrChannelStreamPath } from './device-command.service.js';
import type { ActorContext } from './service-context.js';

export interface DriverPhotoOptions {
  readonly enabled: boolean;
  readonly captureOnConnect: boolean;
  readonly camera: number;
  readonly delaySeconds: number;
  readonly cooldownMinutes: number;
  readonly workerIntervalMs: number;
  readonly batchSize: number;
  readonly matchThreshold: number;
  readonly matchMargin: number;
  /** md300 RTMP stream base (`MDVR_RTMP_PATH`, e.g. `live/md300`). */
  readonly rtmpPath: string;
  /** MediaMTX RTSP base the frame is read from (e.g. `rtsp://mediamtx:8554`). */
  readonly rtspBaseUrl: string;
}

/** Poll interval while AB2 is in flight or the stream is still coming up. */
const COMMAND_POLL_SECONDS = 3;
/** After AB2,OK the unit needs a few seconds to dial RTMP, and MediaMTX to transcode. */
const STREAM_START_TIMEOUT_MS = 45_000;
/** Retry interval when face-service is unreachable. */
const FACE_RETRY_SECONDS = 60;
/** Unfiled photos this recent are re-matched when a new reference is confirmed. */
const REMATCH_WINDOW_DAYS = 30;
const REMATCH_LIMIT = 500;

const AB2_TTL_SECONDS = 90;
const AB3_TTL_SECONDS = 60;

function systemActor(tenantId: string): ActorContext {
  return {
    tenantId,
    actorId: null,
    actorType: 'SYSTEM',
    requestId: null,
    ipAddress: null,
    userAgent: null,
  };
}

function inSeconds(s: number): Date {
  return new Date(Date.now() + s * 1000);
}

export class DriverPhotoService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(DriverPhotoService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly photos: DriverPhotoRepository,
    private readonly devices: DeviceRepository,
    private readonly commandRepo: DeviceCommandRepository,
    private readonly commands: DeviceCommandService,
    private readonly face: FaceEmbedder | null,
    private readonly frames: FrameGrabber | null,
    private readonly options: DriverPhotoOptions,
  ) {}

  public onApplicationBootstrap(): void {
    if (!this.options.enabled || this.options.workerIntervalMs <= 0) {
      this.logger.log('Driver photo capture disabled.');
      return;
    }
    this.timer = setInterval(() => {
      this.tick().catch((err) =>
        this.logger.error(`Driver photo sweep failed: ${(err as Error).message}`),
      );
    }, this.options.workerIntervalMs);
    this.timer.unref();
    this.logger.log(
      `Driver photo worker started (camera=${this.options.camera}, delay=${this.options.delaySeconds}s, face=${this.face ? 'on' : 'off'}).`,
    );
  }

  public onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  // ---------------------------------------------------------------- triggers

  /**
   * Queue a cabin snapshot for a device. Automatic triggers respect the
   * cooldown and only fire for MDVR (Meitrack) units; returns the new photo id
   * or null when nothing was queued.
   */
  public async requestCapture(
    tenantId: string,
    deviceId: string,
    trigger: DriverPhotoTrigger,
    at: Date = new Date(),
  ): Promise<string | null> {
    if (!this.options.enabled) return null;
    if (trigger === 'CONNECT' && !this.options.captureOnConnect) return null;
    const device = await this.devices.findById(tenantId, deviceId);
    if (!device || device.status !== 'ACTIVE' || device.protocol !== 'meitrack') return null;
    const vehicleId = await this.photos.vehicleOfDevice(tenantId, deviceId);
    const id = await this.photos.request({
      tenantId,
      deviceId,
      vehicleId,
      trigger,
      triggeredAt: at,
      camera: this.options.camera,
      captureAfter: trigger === 'MANUAL' ? new Date() : inSeconds(this.options.delaySeconds),
      cooldownMinutes: this.options.cooldownMinutes,
    });
    if (id) this.logger.log(`Driver photo queued (${trigger}) device=${deviceId} photo=${id}`);
    return id;
  }

  // ------------------------------------------------------------------ worker

  public async tick(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const due = await this.photos.claimDue(this.options.batchSize, this.face !== null);
      for (const job of due) {
        try {
          await this.step(job);
        } catch (err) {
          this.logger.warn(`Driver photo ${job.id} step failed: ${(err as Error).message}`);
          await this.retryOrFail(job, (err as Error).message);
        }
      }
      return due.length;
    } finally {
      this.running = false;
    }
  }

  private async step(job: DriverPhotoJob): Promise<void> {
    switch (job.status) {
      case 'PENDING':
        return this.startCapture(job);
      case 'CAPTURING':
        return this.followCapture(job);
      case 'DOWNLOADING':
        // Left over from the old D03 → D00 flow: start over with the live stream.
        return this.startCapture(job);
      case 'READY':
        return this.recognise(job);
      default:
        return;
    }
  }

  private async startCapture(job: DriverPhotoJob): Promise<void> {
    if (!this.frames) return this.retryOrFail(job, 'face-service is not configured');
    const device = await this.devices.findById(job.tenantId, job.deviceId);
    if (!device) return this.retryOrFail(job, 'Device not found');
    const streamPath = mdvrChannelStreamPath(
      this.options.rtmpPath,
      job.camera,
      'live',
      device.imei,
    );

    // An operator may already be watching this camera: take the frame and
    // leave their stream alone (no AB2, no AB3).
    const live = await this.frames.grab(this.webStreamUrl(streamPath));
    if (live) return this.storeFrame(job, live, streamPath, false);

    const record = await this.commands.create(systemActor(job.tenantId), job.deviceId, {
      commandCode: 'AB2',
      params: {
        channel: job.camera,
        dataType: '0',
        streamType: '0',
        // DeviceCommandService pins host, port and per-device stream name.
        uploadUrl: `rtmp://127.0.0.1:1935/${streamPath}`,
      },
      ttlSec: AB2_TTL_SECONDS,
    });
    await this.photos.patch(job.tenantId, job.id, {
      status: 'CAPTURING',
      fileName: streamPath,
      captureCommandId: record.id,
      downloadCommandId: null,
      error: null,
      nextCheckAt: inSeconds(COMMAND_POLL_SECONDS),
    });
  }

  private async followCapture(job: DriverPhotoJob): Promise<void> {
    const cmd = job.captureCommandId
      ? await this.commandRepo.findById(job.tenantId, job.captureCommandId)
      : null;
    if (!cmd) return this.retryOrFail(job, 'Capture command missing');
    if (cmd.command_code !== 'AB2' || !job.fileName || !this.frames) {
      // A D03 from the old flow: start over with the live stream.
      return this.startCapture(job);
    }
    if (cmd.status === 'QUEUED' || cmd.status === 'SENT') {
      await this.photos.patch(job.tenantId, job.id, {
        nextCheckAt: inSeconds(COMMAND_POLL_SECONDS),
      });
      return;
    }
    if (cmd.status !== 'ACKED') {
      return this.retryOrFail(job, `AB2 ${cmd.status}: ${cmd.error ?? cmd.response_text ?? ''}`);
    }
    const frame = await this.frames.grab(this.webStreamUrl(job.fileName));
    if (frame) return this.storeFrame(job, frame, job.fileName, true);
    const ackedAt = cmd.acked_at ? new Date(cmd.acked_at).getTime() : 0;
    if (Date.now() - ackedAt < STREAM_START_TIMEOUT_MS) {
      await this.photos.patch(job.tenantId, job.id, {
        nextCheckAt: inSeconds(COMMAND_POLL_SECONDS),
      });
      return;
    }
    await this.stopStream(job);
    return this.retryOrFail(job, 'Live stream did not start after AB2,OK');
  }

  private async storeFrame(
    job: DriverPhotoJob,
    photo: Buffer,
    streamPath: string,
    startedByUs: boolean,
  ): Promise<void> {
    const stopId = startedByUs ? await this.stopStream(job) : null;
    await this.photos.patch(job.tenantId, job.id, {
      status: 'READY',
      fileName: streamPath,
      photo,
      capturedAt: new Date(),
      downloadCommandId: stopId,
      faceStatus: 'PENDING',
      error: null,
      nextCheckAt: new Date(),
    });
    this.logger.log(`Driver photo ${job.id} captured from ${streamPath} (${photo.length} bytes).`);
  }

  /** AB3 for the stream this job started. Best effort: returns the command id or null. */
  private async stopStream(job: DriverPhotoJob): Promise<string | null> {
    try {
      const record = await this.commands.create(systemActor(job.tenantId), job.deviceId, {
        commandCode: 'AB3',
        params: { channel: job.camera, control: '0', closeType: '0', switchType: '0' },
        ttlSec: AB3_TTL_SECONDS,
      });
      return record.id;
    } catch (err) {
      this.logger.warn(`Driver photo ${job.id}: AB3 failed: ${(err as Error).message}`);
      return null;
    }
  }

  /** MediaMTX republishes every camera as `<path>_web` (H.264) — the reliable one to decode. */
  private webStreamUrl(streamPath: string): string {
    return `${this.options.rtspBaseUrl.replace(/\/+$/, '')}/${streamPath}_web`;
  }

  private async retryOrFail(job: DriverPhotoJob, reason: string): Promise<void> {
    const attempts = job.attempts + 1;
    const error = reason.slice(0, 500);
    if (job.status === 'READY') {
      // Face step: the photo itself is safe — just try face-service again later.
      await this.photos.patch(job.tenantId, job.id, { nextCheckAt: inSeconds(FACE_RETRY_SECONDS) });
      return;
    }
    if (attempts >= MAX_DRIVER_PHOTO_ATTEMPTS) {
      await this.photos.patch(job.tenantId, job.id, { status: 'FAILED', attempts, error });
      this.logger.warn(`Driver photo ${job.id} failed after ${attempts} attempts: ${error}`);
      return;
    }
    await this.photos.patch(job.tenantId, job.id, {
      status: 'PENDING',
      attempts,
      error,
      nextCheckAt: inSeconds(retryDelaySeconds(attempts)),
    });
  }

  // ------------------------------------------------------------- recognition

  private async recognise(job: DriverPhotoJob): Promise<void> {
    if (!this.face) return;
    const photo = await this.photos.loadPhoto(job.tenantId, job.id);
    if (!photo) {
      await this.photos.patch(job.tenantId, job.id, {
        faceStatus: 'ERROR',
        error: 'Photo missing',
      });
      return;
    }
    let result: Awaited<ReturnType<FaceEmbedder['embed']>>;
    try {
      result = await this.face.embed(photo);
    } catch (err) {
      this.logger.warn(`face-service unavailable for photo ${job.id}: ${(err as Error).message}`);
      await this.photos.patch(job.tenantId, job.id, { nextCheckAt: inSeconds(FACE_RETRY_SECONDS) });
      return;
    }
    if (!result) {
      await this.photos.patch(job.tenantId, job.id, { faceStatus: 'NO_FACE', embedding: null });
      return;
    }
    await this.photos.patch(job.tenantId, job.id, {
      faceStatus: 'FOUND',
      faceScore: result.score,
      embedding: result.embedding,
    });
    const references = await this.photos.references(job.tenantId);
    await this.applyMatch(job.tenantId, job.id, result.embedding, references);
  }

  private async applyMatch(
    tenantId: string,
    photoId: string,
    embedding: readonly number[],
    references: Awaited<ReturnType<DriverPhotoRepository['references']>>,
  ): Promise<boolean> {
    const match = matchFace(embedding, references, {
      threshold: this.options.matchThreshold,
      margin: this.options.matchMargin,
    });
    if (match.driverId && match.score !== null) {
      const filed = await this.photos.setAutoMatch(tenantId, photoId, match.driverId, match.score);
      if (filed) {
        this.logger.log(
          `Driver photo ${photoId} matched driver ${match.driverId} (score ${match.score.toFixed(3)}).`,
        );
      }
      return filed;
    }
    await this.photos.setMatchHint(tenantId, photoId, match.score);
    return false;
  }

  /** After a new reference is confirmed, retry the recent photos nobody has filed. */
  private async rematchUnassigned(tenantId: string): Promise<number> {
    const references = await this.photos.references(tenantId);
    if (references.length === 0) return 0;
    const since = new Date(Date.now() - REMATCH_WINDOW_DAYS * 86_400_000);
    const pending = await this.photos.unassignedWithFace(tenantId, since, REMATCH_LIMIT);
    let filed = 0;
    for (const p of pending) {
      if (await this.applyMatch(tenantId, p.id, p.embedding, references)) filed += 1;
    }
    return filed;
  }

  // --------------------------------------------------------------------- API

  public async list(
    ctx: ActorContext,
    filters: {
      matchStatus?: DriverMatchStatus;
      driverId?: string;
      vehicleId?: string;
      readyOnly?: boolean;
      before?: Date;
      limit: number;
    },
  ): Promise<DriverPhotoView[]> {
    return this.photos.list(ctx.tenantId, filters);
  }

  public async counts(ctx: ActorContext): Promise<DriverPhotoCounts> {
    return this.photos.counts(ctx.tenantId);
  }

  public async image(ctx: ActorContext, id: string): Promise<Buffer> {
    const photo = await this.photos.loadPhoto(ctx.tenantId, id);
    if (!photo) throw new NotFoundException('Photo not found.');
    return photo;
  }

  /**
   * Operator files a photo under a driver (or clears it with null). Returns how
   * many other unfiled photos were matched automatically as a result.
   */
  public async assign(
    ctx: ActorContext,
    id: string,
    driverId: string | null,
  ): Promise<{ rematched: number }> {
    if (driverId && !(await this.photos.driverExists(ctx.tenantId, driverId))) {
      throw new BadRequestException('Driver not found.');
    }
    const ok = await this.photos.assign(ctx.tenantId, id, driverId, ctx.actorId);
    if (!ok) throw new NotFoundException('Photo not found.');
    if (!driverId) return { rematched: 0 };
    const rematched = await this.rematchUnassigned(ctx.tenantId);
    return { rematched };
  }

  public async remove(ctx: ActorContext, id: string): Promise<void> {
    const ok = await this.photos.remove(ctx.tenantId, id);
    if (!ok) throw new NotFoundException('Photo not found.');
  }

  /** Take a snapshot now (operator button) — skips the delay and the cooldown. */
  public async captureNow(ctx: ActorContext, deviceId: string): Promise<{ id: string }> {
    if (!this.options.enabled) throw new BadRequestException('Driver photo capture is disabled.');
    const device = await this.devices.findById(ctx.tenantId, deviceId);
    if (!device) throw new NotFoundException('Device not found.');
    if (device.protocol !== 'meitrack') {
      throw new BadRequestException('Only MDVR (Meitrack) devices have a cabin camera.');
    }
    const id = await this.requestCapture(ctx.tenantId, deviceId, 'MANUAL');
    if (!id) throw new BadRequestException('Device is not active.');
    return { id };
  }
}
