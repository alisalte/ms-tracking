/**
 * Enqueue platform evidence rows for DMS/ADAS alarms (F-07).
 */
import { Logger } from '@nestjs/common';
import {
  computeVideoWindow,
  extractCabinChannel,
  extractPhotoName,
  isDmsOrAdasAlarmCode,
} from '../domain/alarm-evidence.js';
import type { AlarmEvidenceRepository } from '../infrastructure/persistence/alarm-evidence.repository.js';

export interface EnqueueEvidenceInput {
  tenantId: string;
  alertId: string;
  deviceId: string;
  vehicleId: string | null;
  alarmCode: string;
  detail: Record<string, unknown> | null;
  raisedAt: Date;
}

export class AlarmEvidenceService {
  private readonly logger = new Logger(AlarmEvidenceService.name);

  constructor(private readonly evidence: AlarmEvidenceRepository) {}

  public async enqueueForDeviceAlarm(input: EnqueueEvidenceInput): Promise<void> {
    if (!isDmsOrAdasAlarmCode(input.alarmCode)) return;

    const existing = await this.evidence.findByAlert(input.tenantId, input.alertId);
    if (existing) return;

    const photoName = extractPhotoName(input.detail);
    const window = computeVideoWindow(input.raisedAt);
    const channel = extractCabinChannel(photoName);

    const recent = await this.evidence.hasRecentCapture(
      input.tenantId,
      input.deviceId,
      input.alarmCode,
    );
    if (recent) {
      await this.evidence.insert({
        tenantId: input.tenantId,
        alertId: input.alertId,
        deviceId: input.deviceId,
        vehicleId: input.vehicleId,
        alarmType: input.alarmCode,
        status: 'SKIPPED_COOLDOWN',
        photoName,
        videoWindowFrom: window.from,
        videoWindowTo: window.to,
        videoStatus: 'SKIPPED',
        videoChannel: channel,
        error: 'Media cooldown — another capture for this type within 1 minute',
      });
      this.logger.log(
        `Evidence SKIPPED_COOLDOWN alert=${input.alertId} type=${input.alarmCode}`,
      );
      return;
    }

    if (!photoName) {
      await this.evidence.insert({
        tenantId: input.tenantId,
        alertId: input.alertId,
        deviceId: input.deviceId,
        vehicleId: input.vehicleId,
        alarmType: input.alarmCode,
        status: 'PHOTO_MISSING',
        photoName: null,
        videoWindowFrom: window.from,
        videoWindowTo: window.to,
        videoStatus: 'PENDING',
        videoChannel: channel,
        error: 'Device did not report photoName for this alarm',
      });
      return;
    }

    await this.evidence.insert({
      tenantId: input.tenantId,
      alertId: input.alertId,
      deviceId: input.deviceId,
      vehicleId: input.vehicleId,
      alarmType: input.alarmCode,
      status: 'PENDING',
      photoName,
      videoWindowFrom: window.from,
      videoWindowTo: window.to,
      videoStatus: 'PENDING',
      videoChannel: channel,
    });
  }

  public async getForAlert(tenantId: string, alertId: string) {
    const evidence = await this.evidence.findByAlert(tenantId, alertId, false);
    if (!evidence) return null;
    return {
      id: evidence.id,
      alertId: evidence.alertId,
      status: evidence.status,
      photoName: evidence.photoName,
      photoAvailable: evidence.status === 'PHOTO_READY',
      error: evidence.error,
      videoStatus: evidence.videoStatus,
      videoChannel: evidence.videoChannel,
      videoAvailable: evidence.videoStatus === 'READY',
      videoWindowFrom: evidence.videoWindowFrom?.toISOString() ?? null,
      videoWindowTo: evidence.videoWindowTo?.toISOString() ?? null,
      expiresAt: evidence.expiresAt.toISOString(),
      createdAt: evidence.createdAt.toISOString(),
      updatedAt: evidence.updatedAt.toISOString(),
    };
  }

  public async getPhoto(
    tenantId: string,
    alertId: string,
  ): Promise<{ bytes: Buffer; contentType: string; filename: string } | null> {
    const row = await this.evidence.findByAlert(tenantId, alertId, true);
    if (!row || row.status !== 'PHOTO_READY' || !row.photoBytes) return null;
    return {
      bytes: row.photoBytes,
      contentType: row.photoContentType ?? 'image/jpeg',
      filename: row.photoName ?? 'evidence.jpg',
    };
  }
}
