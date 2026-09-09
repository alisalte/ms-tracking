/**
 * Cross-schema access to notification.alarm_evidence (F-07).
 * Owned by notification-service migrations; fleet-management runs D00/AB4 workers.
 */
import { type Knex, withPlatformContext, withTenantContext } from '@fleetvision/persistence-knex';

export type EvidenceStatus =
  | 'PENDING'
  | 'FETCHING'
  | 'PHOTO_READY'
  | 'PHOTO_MISSING'
  | 'PHOTO_FAILED'
  | 'SKIPPED_COOLDOWN';

export type VideoEvidenceStatus = 'PENDING' | 'FETCHING' | 'READY' | 'FAILED' | 'SKIPPED';

export interface EvidenceJob {
  readonly id: string;
  readonly tenantId: string;
  readonly alertId: string;
  readonly deviceId: string;
  readonly photoName: string | null;
  readonly status: EvidenceStatus;
  readonly videoStatus: VideoEvidenceStatus | null;
  readonly videoChannel: number | null;
  readonly videoWindowFrom: Date | null;
  readonly videoWindowTo: Date | null;
}

interface EvidenceRow {
  id: string;
  tenant_id: string;
  alert_id: string;
  device_id: string;
  photo_name: string | null;
  status: string;
  video_status: string | null;
  video_channel: number | null;
  video_window_from: Date | string | null;
  video_window_to: Date | string | null;
}

function asDateOrNull(v: Date | string | null): Date | null {
  if (v == null) return null;
  return v instanceof Date ? v : new Date(v);
}

function mapJob(r: EvidenceRow): EvidenceJob {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    alertId: r.alert_id,
    deviceId: r.device_id,
    photoName: r.photo_name,
    status: r.status as EvidenceStatus,
    videoStatus: (r.video_status as VideoEvidenceStatus | null) ?? null,
    videoChannel: r.video_channel,
    videoWindowFrom: asDateOrNull(r.video_window_from),
    videoWindowTo: asDateOrNull(r.video_window_to),
  };
}

const JOB_COLS = [
  'id',
  'tenant_id',
  'alert_id',
  'device_id',
  'photo_name',
  'status',
  'video_status',
  'video_channel',
  'video_window_from',
  'video_window_to',
] as const;

export class EvidenceCaptureRepository {
  constructor(private readonly knex: Knex) {}

  public async claimPending(limit: number): Promise<EvidenceJob[]> {
    return withPlatformContext(this.knex, async (trx) => {
      const rows = await trx('notification.alarm_evidence')
        .where({ status: 'PENDING' })
        .orderBy('created_at', 'asc')
        .limit(limit)
        .forUpdate()
        .skipLocked()
        .select<EvidenceRow[]>(...JOB_COLS);

      const claimed: EvidenceJob[] = [];
      for (const row of rows) {
        const updated = await trx('notification.alarm_evidence')
          .where({ id: row.id, status: 'PENDING' })
          .update({ status: 'FETCHING', updated_at: trx.fn.now() })
          .returning<EvidenceRow[]>([...JOB_COLS]);
        if (updated[0]) claimed.push(mapJob(updated[0]));
      }
      return claimed;
    });
  }

  public async claimVideoPending(limit: number): Promise<EvidenceJob[]> {
    return withPlatformContext(this.knex, async (trx) => {
      const rows = await trx('notification.alarm_evidence')
        .where({ video_status: 'PENDING' })
        .whereNotNull('video_window_from')
        .whereNotNull('video_window_to')
        .orderBy('created_at', 'asc')
        .limit(limit)
        .forUpdate()
        .skipLocked()
        .select<EvidenceRow[]>(...JOB_COLS);

      const claimed: EvidenceJob[] = [];
      for (const row of rows) {
        const updated = await trx('notification.alarm_evidence')
          .where({ id: row.id, video_status: 'PENDING' })
          .update({ video_status: 'FETCHING', updated_at: trx.fn.now() })
          .returning<EvidenceRow[]>([...JOB_COLS]);
        if (updated[0]) claimed.push(mapJob(updated[0]));
      }
      return claimed;
    });
  }

  public async markFetchingWithCommand(
    tenantId: string,
    id: string,
    commandId: string,
  ): Promise<void> {
    await withTenantContext(this.knex, tenantId, async (trx) => {
      await trx('notification.alarm_evidence').where({ tenant_id: tenantId, id }).update({
        status: 'FETCHING',
        command_id: commandId,
        updated_at: trx.fn.now(),
      });
    });
  }

  public async markVideoFetching(
    tenantId: string,
    id: string,
    commandId: string,
    channel: number,
  ): Promise<void> {
    await withTenantContext(this.knex, tenantId, async (trx) => {
      await trx('notification.alarm_evidence').where({ tenant_id: tenantId, id }).update({
        video_status: 'FETCHING',
        video_command_id: commandId,
        video_channel: channel,
        updated_at: trx.fn.now(),
      });
    });
  }

  public async markFailed(tenantId: string, id: string, error: string): Promise<void> {
    await withTenantContext(this.knex, tenantId, async (trx) => {
      await trx('notification.alarm_evidence').where({ tenant_id: tenantId, id }).update({
        status: 'PHOTO_FAILED',
        error: error.slice(0, 2000),
        updated_at: trx.fn.now(),
      });
    });
  }

  public async markVideoFailed(tenantId: string, id: string, error: string): Promise<void> {
    await withTenantContext(this.knex, tenantId, async (trx) => {
      await trx('notification.alarm_evidence').where({ tenant_id: tenantId, id }).update({
        video_status: 'FAILED',
        error: error.slice(0, 2000),
        updated_at: trx.fn.now(),
      });
    });
  }

  public async findByCommandId(commandId: string): Promise<EvidenceJob | null> {
    return withPlatformContext(this.knex, async (trx) => {
      const row = await trx('notification.alarm_evidence')
        .where({ command_id: commandId })
        .first<EvidenceRow>(...JOB_COLS);
      return row ? mapJob(row) : null;
    });
  }

  public async findByVideoCommandId(commandId: string): Promise<EvidenceJob | null> {
    return withPlatformContext(this.knex, async (trx) => {
      const row = await trx('notification.alarm_evidence')
        .where({ video_command_id: commandId })
        .first<EvidenceRow>(...JOB_COLS);
      return row ? mapJob(row) : null;
    });
  }

  public async markPhotoReady(
    tenantId: string,
    id: string,
    photoBytes: Buffer,
    contentType: string,
    filename?: string | null,
  ): Promise<void> {
    await withTenantContext(this.knex, tenantId, async (trx) => {
      const patch: Record<string, unknown> = {
        status: 'PHOTO_READY',
        photo_bytes: photoBytes,
        photo_content_type: contentType,
        error: null,
        updated_at: trx.fn.now(),
      };
      if (filename) patch.photo_name = filename;
      await trx('notification.alarm_evidence').where({ tenant_id: tenantId, id }).update(patch);
    });
  }

  public async markVideoReady(tenantId: string, id: string): Promise<void> {
    await withTenantContext(this.knex, tenantId, async (trx) => {
      await trx('notification.alarm_evidence').where({ tenant_id: tenantId, id }).update({
        video_status: 'READY',
        updated_at: trx.fn.now(),
      });
    });
  }

  public async markFailedByCommandId(commandId: string, error: string): Promise<void> {
    return withPlatformContext(this.knex, async (trx) => {
      const photo = await trx('notification.alarm_evidence')
        .where({ command_id: commandId })
        .update({
          status: 'PHOTO_FAILED',
          error: error.slice(0, 2000),
          updated_at: trx.fn.now(),
        });
      if (photo > 0) return;
      await trx('notification.alarm_evidence').where({ video_command_id: commandId }).update({
        video_status: 'FAILED',
        error: error.slice(0, 2000),
        updated_at: trx.fn.now(),
      });
    });
  }
}
