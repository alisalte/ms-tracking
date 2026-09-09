/**
 * Persistence for notification.alarm_evidence.
 */
import { type Knex, withPlatformContext, withTenantContext } from '@fleetvision/persistence-knex';
import {
  type AlarmEvidenceRecord,
  type EvidenceStatus,
  type VideoEvidenceStatus,
  EVIDENCE_COOLDOWN_MS,
  computeEvidenceExpiry,
} from '../../domain/alarm-evidence.js';

interface EvidenceRow {
  id: string;
  tenant_id: string;
  alert_id: string;
  device_id: string;
  vehicle_id: string | null;
  alarm_type: string;
  status: string;
  photo_name: string | null;
  photo_bytes: Buffer | null;
  photo_content_type: string | null;
  command_id: string | null;
  error: string | null;
  video_window_from: Date | string | null;
  video_window_to: Date | string | null;
  video_object_key: string | null;
  video_status: string | null;
  video_channel: number | null;
  video_command_id: string | null;
  expires_at: Date | string;
  created_at: Date | string;
  updated_at: Date | string;
}

function asDate(v: Date | string): Date {
  return v instanceof Date ? v : new Date(v);
}

function asDateOrNull(v: Date | string | null): Date | null {
  return v == null ? null : asDate(v);
}

function mapRow(r: EvidenceRow, includeBytes = false): AlarmEvidenceRecord {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    alertId: r.alert_id,
    deviceId: r.device_id,
    vehicleId: r.vehicle_id,
    alarmType: r.alarm_type,
    status: r.status as EvidenceStatus,
    photoName: r.photo_name,
    photoBytes: includeBytes ? r.photo_bytes : null,
    photoContentType: r.photo_content_type,
    commandId: r.command_id,
    error: r.error,
    videoWindowFrom: asDateOrNull(r.video_window_from),
    videoWindowTo: asDateOrNull(r.video_window_to),
    videoObjectKey: r.video_object_key,
    videoStatus: (r.video_status as VideoEvidenceStatus | null) ?? null,
    videoChannel: r.video_channel,
    videoCommandId: r.video_command_id,
    expiresAt: asDate(r.expires_at),
    createdAt: asDate(r.created_at),
    updatedAt: asDate(r.updated_at),
  };
}

export class AlarmEvidenceRepository {
  constructor(private readonly knex: Knex) {}

  public async findByAlert(
    tenantId: string,
    alertId: string,
    includeBytes = false,
  ): Promise<AlarmEvidenceRecord | null> {
    return withTenantContext(this.knex, tenantId, async (trx) => {
      const row = await trx('notification.alarm_evidence')
        .where({ tenant_id: tenantId, alert_id: alertId })
        .first<EvidenceRow>();
      return row ? mapRow(row, includeBytes) : null;
    });
  }

  public async hasRecentCapture(
    tenantId: string,
    deviceId: string,
    alarmType: string,
    withinMs: number = EVIDENCE_COOLDOWN_MS,
  ): Promise<boolean> {
    return withTenantContext(this.knex, tenantId, async (trx) => {
      const since = new Date(Date.now() - withinMs);
      const row = await trx('notification.alarm_evidence')
        .where({ tenant_id: tenantId, device_id: deviceId, alarm_type: alarmType })
        .whereIn('status', ['PENDING', 'FETCHING', 'PHOTO_READY', 'PHOTO_MISSING', 'PHOTO_FAILED'])
        .andWhere('created_at', '>=', since)
        .first('id');
      return Boolean(row);
    });
  }

  public async insert(input: {
    tenantId: string;
    alertId: string;
    deviceId: string;
    vehicleId: string | null;
    alarmType: string;
    status: EvidenceStatus;
    photoName: string | null;
    videoWindowFrom: Date | null;
    videoWindowTo: Date | null;
    videoStatus: VideoEvidenceStatus | null;
    videoChannel: number | null;
    error?: string | null;
  }): Promise<AlarmEvidenceRecord> {
    return withTenantContext(this.knex, input.tenantId, async (trx) => {
      const inserted = await trx('notification.alarm_evidence')
        .insert({
          tenant_id: input.tenantId,
          alert_id: input.alertId,
          device_id: input.deviceId,
          vehicle_id: input.vehicleId,
          alarm_type: input.alarmType,
          status: input.status,
          photo_name: input.photoName,
          video_window_from: input.videoWindowFrom,
          video_window_to: input.videoWindowTo,
          video_status: input.videoStatus,
          video_channel: input.videoChannel,
          error: input.error ?? null,
          expires_at: computeEvidenceExpiry(),
        })
        .returning<EvidenceRow[]>('*');
      const row = inserted[0];
      if (!row) throw new Error('Failed to insert alarm_evidence');
      return mapRow(row);
    });
  }

  public async deleteExpired(now: Date = new Date()): Promise<number> {
    return withPlatformContext(this.knex, async (trx) => {
      return trx('notification.alarm_evidence').where('expires_at', '<=', now).delete();
    });
  }
}
