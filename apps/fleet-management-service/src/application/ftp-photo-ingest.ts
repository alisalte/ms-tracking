/**
 * FtpPhotoIngest — attaches FTP-uploaded MDVR snapshots to alarm evidence.
 *
 * Each unit logs in with its IMEI and a password derived from it
 * (`ftpPasswordFor`), so the login identifies the device and a password seen
 * in one device's B64 command opens no other account. The photo is matched
 * to the waiting evidence row by the name the alarm reported (FE31); the
 * upload can beat notification-service's evidence row, so unmatched photos
 * are retried for a few minutes before they are dropped.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { posix } from 'node:path';
import { Logger } from '@nestjs/common';

import type { FtpUploadedFile } from '../infrastructure/ftp/ftp-photo-server.js';
import {
  type EvidencePhotoCompression,
  compressEvidencePhoto,
} from '../infrastructure/media/evidence-photo-compressor.js';
import type { DeviceRepository } from '../infrastructure/persistence/device.repository.js';
import type { EvidenceCaptureRepository } from '../infrastructure/persistence/evidence-capture.repository.js';

const IMEI = /^\d{8,20}$/;
/** `20261019055951_CH1` — time + camera prefix of an MDVR event photo name. */
const PHOTO_STEM = /^(\d{14}_CH\d+)/i;
const RETRY_INTERVAL_MS = 15_000;
const RETRY_WINDOW_MS = 10 * 60_000;
const MAX_UNMATCHED = 200;

export function ftpPasswordFor(secret: string, imei: string): string {
  return createHmac('sha256', secret).update(`ftp:${imei}`).digest('hex').slice(0, 16);
}

interface Unmatched {
  readonly tenantId: string;
  readonly deviceId: string;
  readonly name: string;
  readonly bytes: Buffer;
  readonly until: number;
}

export interface FtpPhotoIngestDeps {
  readonly secret: string;
  readonly devices: Pick<DeviceRepository, 'resolveByImei'>;
  readonly evidence: Pick<
    EvidenceCaptureRepository,
    'markPhotoReadyByName' | 'markPhotoReadyByStem'
  >;
  readonly compression: EvidencePhotoCompression;
  readonly now?: () => number;
}

export class FtpPhotoIngest {
  private readonly logger = new Logger('FtpPhotoIngest');
  private readonly unmatched: Unmatched[] = [];
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly deps: FtpPhotoIngestDeps) {}

  public authenticate = (user: string, password: string): boolean => {
    if (!this.deps.secret || !IMEI.test(user)) return false;
    const expected = Buffer.from(ftpPasswordFor(this.deps.secret, user));
    const given = Buffer.from(password);
    return given.length === expected.length && timingSafeEqual(given, expected);
  };

  public onFile = async (file: FtpUploadedFile): Promise<void> => {
    const name = posix.basename(file.path);
    const isJpeg = file.bytes[0] === 0xff && file.bytes[1] === 0xd8;
    if (!isJpeg) {
      this.logger.log(`FTP upload ${name} from ${file.user} is not a JPEG — ignored.`);
      return;
    }
    const resolved = await this.deps.devices.resolveByImei(file.user);
    if (!resolved.found || !resolved.device) {
      this.logger.warn(`FTP upload from unknown IMEI ${file.user} (${name}) dropped.`);
      return;
    }
    const { tenantId, deviceId } = resolved.device;
    const bytes = await compressEvidencePhoto(file.bytes, this.deps.compression);
    const attached = await this.attach(tenantId, deviceId, name, bytes);
    if (attached > 0) {
      this.logger.log(
        `FTP photo ${name} attached to ${attached} alarm(s) (${bytes.length} bytes).`,
      );
      return;
    }
    this.logger.log(
      `FTP photo ${name} has no alarm yet — retrying for ${RETRY_WINDOW_MS / 60_000} min.`,
    );
    if (this.unmatched.length >= MAX_UNMATCHED) this.unmatched.shift();
    this.unmatched.push({ tenantId, deviceId, name, bytes, until: this.now() + RETRY_WINDOW_MS });
    this.schedule();
  };

  /** Retry unmatched uploads now (also run by the timer). */
  public async retryUnmatched(): Promise<void> {
    const due = this.unmatched.splice(0);
    for (const item of due) {
      const attached = await this.attach(item.tenantId, item.deviceId, item.name, item.bytes).catch(
        () => 0,
      );
      if (attached > 0) {
        this.logger.log(`FTP photo ${item.name} attached on retry.`);
      } else if (item.until > this.now()) {
        this.unmatched.push(item);
      } else {
        this.logger.warn(`FTP photo ${item.name} matched no alarm — dropped.`);
      }
    }
    if (this.unmatched.length > 0) this.schedule();
  }

  public get pendingCount(): number {
    return this.unmatched.length;
  }

  public stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  private schedule(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.retryUnmatched();
    }, RETRY_INTERVAL_MS);
    this.timer.unref?.();
  }

  /** Exact reported name first; else the unit's time+camera stem (it may add a suffix). */
  private async attach(
    tenantId: string,
    deviceId: string,
    name: string,
    bytes: Buffer,
  ): Promise<number> {
    const exact = await this.deps.evidence.markPhotoReadyByName(
      tenantId,
      deviceId,
      name,
      bytes,
      'image/jpeg',
    );
    if (exact > 0) return exact;
    const stem = PHOTO_STEM.exec(name)?.[1];
    if (!stem) return 0;
    return this.deps.evidence.markPhotoReadyByStem(tenantId, deviceId, stem, bytes, 'image/jpeg');
  }
}
