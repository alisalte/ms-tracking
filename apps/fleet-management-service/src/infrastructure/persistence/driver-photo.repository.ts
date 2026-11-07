/**
 * fleet.driver_photos — cabin snapshots that identify the driver of a shift.
 *
 * The capture worker claims due rows across all tenants (platform context,
 * FOR UPDATE SKIP LOCKED); every other read and write is tenant-scoped.
 */
import { type Knex, withPlatformContext, withTenantContext } from '@fleetvision/persistence-knex';
import type {
  DriverFaceStatus,
  DriverMatchStatus,
  DriverPhotoStatus,
  DriverPhotoTrigger,
  FaceReference,
} from '../../domain/driver-photo.js';

const TABLE = 'fleet.driver_photos';

/** Seconds a claimed row stays hidden from other workers while it is handled. */
const CLAIM_LEASE_SECONDS = 20;

export interface DriverPhotoJob {
  readonly id: string;
  readonly tenantId: string;
  readonly deviceId: string;
  readonly vehicleId: string | null;
  readonly camera: number;
  readonly fileName: string | null;
  readonly status: DriverPhotoStatus;
  readonly attempts: number;
  readonly captureCommandId: string | null;
  readonly downloadCommandId: string | null;
  readonly faceStatus: DriverFaceStatus | null;
}

export interface DriverPhotoView {
  readonly id: string;
  readonly deviceId: string;
  readonly deviceImei: string | null;
  readonly vehicleId: string | null;
  readonly vehicleName: string | null;
  readonly trigger: DriverPhotoTrigger;
  readonly triggeredAt: Date;
  readonly capturedAt: Date | null;
  readonly status: DriverPhotoStatus;
  readonly error: string | null;
  readonly faceStatus: DriverFaceStatus | null;
  readonly faceScore: number | null;
  readonly driverId: string | null;
  readonly driverName: string | null;
  readonly matchStatus: DriverMatchStatus;
  readonly matchScore: number | null;
  readonly matchedAt: Date | null;
}

export interface DriverPhotoListFilters {
  readonly matchStatus?: DriverMatchStatus;
  readonly driverId?: string;
  readonly vehicleId?: string;
  /** Only photos whose capture finished (READY). */
  readonly readyOnly?: boolean;
  /** Cursor: rows triggered strictly before this instant. */
  readonly before?: Date;
  readonly limit: number;
}

export interface DriverPhotoCounts {
  readonly unassigned: number;
  readonly auto: number;
  readonly confirmed: number;
  readonly inProgress: number;
  readonly failed: number;
}

interface JobRow {
  id: string;
  tenant_id: string;
  device_id: string;
  vehicle_id: string | null;
  camera: number;
  file_name: string | null;
  status: string;
  attempts: number;
  capture_command_id: string | null;
  download_command_id: string | null;
  face_status: string | null;
}

const JOB_COLS = [
  'id',
  'tenant_id',
  'device_id',
  'vehicle_id',
  'camera',
  'file_name',
  'status',
  'attempts',
  'capture_command_id',
  'download_command_id',
  'face_status',
] as const;

function mapJob(r: JobRow): DriverPhotoJob {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    deviceId: r.device_id,
    vehicleId: r.vehicle_id,
    camera: Number(r.camera),
    fileName: r.file_name,
    status: r.status as DriverPhotoStatus,
    attempts: Number(r.attempts),
    captureCommandId: r.capture_command_id,
    downloadCommandId: r.download_command_id,
    faceStatus: (r.face_status as DriverFaceStatus | null) ?? null,
  };
}

function asDate(v: Date | string | null): Date | null {
  if (v == null) return null;
  return v instanceof Date ? v : new Date(v);
}

function asNum(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export interface DriverPhotoPatch {
  readonly status?: DriverPhotoStatus;
  readonly nextCheckAt?: Date;
  readonly attempts?: number;
  readonly captureCommandId?: string | null;
  readonly downloadCommandId?: string | null;
  readonly fileName?: string;
  readonly error?: string | null;
  readonly capturedAt?: Date;
  readonly photo?: Buffer;
  readonly faceStatus?: DriverFaceStatus | null;
  readonly faceScore?: number | null;
  readonly embedding?: readonly number[] | null;
}

export class DriverPhotoRepository {
  constructor(private readonly knex: Knex) {}

  /**
   * Queue a snapshot for a device. Returns null when the device already has a
   * snapshot newer than `cooldownMinutes` (manual requests skip the cooldown).
   */
  public async request(input: {
    readonly tenantId: string;
    readonly deviceId: string;
    readonly vehicleId: string | null;
    readonly trigger: DriverPhotoTrigger;
    readonly triggeredAt: Date;
    readonly camera: number;
    readonly captureAfter: Date;
    readonly cooldownMinutes: number;
  }): Promise<string | null> {
    return withTenantContext(this.knex, input.tenantId, async (trx) => {
      // Serialise requests per device so two triggers (ignition + connect)
      // arriving together cannot both pass the cooldown check.
      await trx.raw('SELECT pg_advisory_xact_lock(hashtext(?))', [
        `driver-photo:${input.deviceId}`,
      ]);
      if (input.trigger !== 'MANUAL' && input.cooldownMinutes > 0) {
        const since = new Date(input.triggeredAt.getTime() - input.cooldownMinutes * 60_000);
        const recent = await trx(TABLE)
          .where({ tenant_id: input.tenantId, device_id: input.deviceId })
          .where('triggered_at', '>', since)
          .whereNot('status', 'FAILED')
          .first('id');
        if (recent) return null;
      }
      const [row] = await trx(TABLE)
        .insert({
          tenant_id: input.tenantId,
          device_id: input.deviceId,
          vehicle_id: input.vehicleId,
          trigger: input.trigger,
          triggered_at: input.triggeredAt,
          camera: input.camera,
          next_check_at: input.captureAfter,
        })
        .returning<{ id: string }[]>(['id']);
      return row?.id ?? null;
    });
  }

  /**
   * Claim rows the worker should look at now: capture steps that are due, and
   * READY photos still waiting for face-service (only when `withFace`).
   */
  public async claimDue(limit: number, withFace: boolean): Promise<DriverPhotoJob[]> {
    return withPlatformContext(this.knex, async (trx) => {
      const rows = await trx(TABLE)
        .where('next_check_at', '<=', trx.fn.now())
        .where((q) => {
          q.whereIn('status', ['PENDING', 'CAPTURING', 'DOWNLOADING']);
          if (withFace)
            q.orWhere((r) => r.where('status', 'READY').where('face_status', 'PENDING'));
        })
        .orderBy('next_check_at', 'asc')
        .limit(limit)
        .forUpdate()
        .skipLocked()
        .select<JobRow[]>(...JOB_COLS);
      if (rows.length === 0) return [];
      await trx(TABLE)
        .whereIn(
          'id',
          rows.map((r) => r.id),
        )
        .update({
          next_check_at: trx.raw(`now() + interval '${CLAIM_LEASE_SECONDS} seconds'`),
        });
      return rows.map(mapJob);
    });
  }

  public async patch(tenantId: string, id: string, patch: DriverPhotoPatch): Promise<void> {
    const row: Record<string, unknown> = { updated_at: this.knex.fn.now() };
    if (patch.status !== undefined) row.status = patch.status;
    if (patch.nextCheckAt !== undefined) row.next_check_at = patch.nextCheckAt;
    if (patch.attempts !== undefined) row.attempts = patch.attempts;
    if (patch.captureCommandId !== undefined) row.capture_command_id = patch.captureCommandId;
    if (patch.downloadCommandId !== undefined) row.download_command_id = patch.downloadCommandId;
    if (patch.fileName !== undefined) row.file_name = patch.fileName;
    if (patch.error !== undefined) row.error = patch.error;
    if (patch.capturedAt !== undefined) row.captured_at = patch.capturedAt;
    if (patch.photo !== undefined) row.photo = patch.photo;
    if (patch.faceStatus !== undefined) row.face_status = patch.faceStatus;
    if (patch.faceScore !== undefined) row.face_score = patch.faceScore;
    if (patch.embedding !== undefined)
      row.embedding = patch.embedding ? [...patch.embedding] : null;
    await withTenantContext(this.knex, tenantId, async (trx) => {
      await trx(TABLE).where({ tenant_id: tenantId, id }).update(row);
    });
  }

  public async loadPhoto(tenantId: string, id: string): Promise<Buffer | null> {
    return withTenantContext(this.knex, tenantId, async (trx) => {
      const row = await trx(TABLE)
        .where({ tenant_id: tenantId, id })
        .first<{ photo: Buffer | null }>('photo');
      return row?.photo ?? null;
    });
  }

  public async loadEmbedding(tenantId: string, id: string): Promise<number[] | null> {
    return withTenantContext(this.knex, tenantId, async (trx) => {
      const row = await trx(TABLE)
        .where({ tenant_id: tenantId, id })
        .first<{ embedding: number[] | null }>('embedding');
      return row?.embedding ? row.embedding.map(Number) : null;
    });
  }

  /** Confirmed faces of the tenant's active drivers — the auto-match reference set. */
  public async references(tenantId: string): Promise<FaceReference[]> {
    return withTenantContext(this.knex, tenantId, async (trx) => {
      const rows = await trx(`${TABLE} as p`)
        .join('fleet.drivers as d', function () {
          this.on('d.id', '=', 'p.driver_id').andOn('d.tenant_id', '=', 'p.tenant_id');
        })
        .where('p.tenant_id', tenantId)
        .where('p.match_status', 'CONFIRMED')
        .where('p.face_status', 'FOUND')
        .whereNotNull('p.embedding')
        .where('d.status', 'ACTIVE')
        .select<{ driver_id: string; embedding: number[] }[]>('p.driver_id', 'p.embedding');
      return rows.map((r) => ({ driverId: r.driver_id, embedding: r.embedding.map(Number) }));
    });
  }

  /** Recent photos with a face that nobody has filed yet (re-matched after a confirmation). */
  public async unassignedWithFace(
    tenantId: string,
    since: Date,
    limit: number,
  ): Promise<Array<{ id: string; embedding: number[] }>> {
    return withTenantContext(this.knex, tenantId, async (trx) => {
      const rows = await trx(TABLE)
        .where({ tenant_id: tenantId, match_status: 'UNASSIGNED', face_status: 'FOUND' })
        .whereNotNull('embedding')
        .where('triggered_at', '>=', since)
        .orderBy('triggered_at', 'desc')
        .limit(limit)
        .select<{ id: string; embedding: number[] }[]>('id', 'embedding');
      return rows.map((r) => ({ id: r.id, embedding: r.embedding.map(Number) }));
    });
  }

  /** File a photo automatically; never overrides an operator's decision. */
  public async setAutoMatch(
    tenantId: string,
    id: string,
    driverId: string,
    score: number,
  ): Promise<boolean> {
    return withTenantContext(this.knex, tenantId, async (trx) => {
      const n = await trx(TABLE)
        .where({ tenant_id: tenantId, id, match_status: 'UNASSIGNED' })
        .update({
          driver_id: driverId,
          match_status: 'AUTO',
          match_score: score,
          matched_at: trx.fn.now(),
          updated_at: trx.fn.now(),
        });
      return n > 0;
    });
  }

  /** Record the best (uncertain) score on an unassigned photo, as a hint for the operator. */
  public async setMatchHint(tenantId: string, id: string, score: number | null): Promise<void> {
    await withTenantContext(this.knex, tenantId, async (trx) => {
      await trx(TABLE)
        .where({ tenant_id: tenantId, id, match_status: 'UNASSIGNED' })
        .update({ match_score: score, updated_at: trx.fn.now() });
    });
  }

  /** Operator files the photo under a driver (CONFIRMED) or clears it (UNASSIGNED). */
  public async assign(
    tenantId: string,
    id: string,
    driverId: string | null,
    actorId: string | null,
  ): Promise<boolean> {
    return withTenantContext(this.knex, tenantId, async (trx) => {
      const n = await trx(TABLE)
        .where({ tenant_id: tenantId, id })
        .update({
          driver_id: driverId,
          match_status: driverId ? 'CONFIRMED' : 'UNASSIGNED',
          match_score: null,
          matched_at: driverId ? trx.fn.now() : null,
          assigned_by: actorId,
          updated_at: trx.fn.now(),
        });
      return n > 0;
    });
  }

  public async remove(tenantId: string, id: string): Promise<boolean> {
    return withTenantContext(this.knex, tenantId, async (trx) => {
      const n = await trx(TABLE).where({ tenant_id: tenantId, id }).delete();
      return n > 0;
    });
  }

  public async driverExists(tenantId: string, driverId: string): Promise<boolean> {
    return withTenantContext(this.knex, tenantId, async (trx) => {
      const row = await trx('fleet.drivers')
        .where({ tenant_id: tenantId, id: driverId })
        .first('id');
      return Boolean(row);
    });
  }

  /** The vehicle the device is bound to right now, if any. */
  public async vehicleOfDevice(tenantId: string, deviceId: string): Promise<string | null> {
    return withTenantContext(this.knex, tenantId, async (trx) => {
      const row = await trx('fleet.vehicle_devices')
        .where({ tenant_id: tenantId, device_id: deviceId })
        .first<{ vehicle_id: string }>('vehicle_id');
      return row?.vehicle_id ?? null;
    });
  }

  public async list(tenantId: string, f: DriverPhotoListFilters): Promise<DriverPhotoView[]> {
    return withTenantContext(this.knex, tenantId, async (trx) => {
      const q = trx(`${TABLE} as p`)
        .leftJoin('fleet.devices as dv', 'dv.id', 'p.device_id')
        .leftJoin('fleet.vehicles as v', 'v.id', 'p.vehicle_id')
        .leftJoin('fleet.drivers as d', function () {
          this.on('d.id', '=', 'p.driver_id').andOn('d.tenant_id', '=', 'p.tenant_id');
        })
        .where('p.tenant_id', tenantId);
      if (f.matchStatus) q.where('p.match_status', f.matchStatus);
      if (f.driverId) q.where('p.driver_id', f.driverId);
      if (f.vehicleId) q.where('p.vehicle_id', f.vehicleId);
      if (f.readyOnly) q.where('p.status', 'READY');
      if (f.before) q.where('p.triggered_at', '<', f.before);
      const rows = await q
        .orderBy('p.triggered_at', 'desc')
        .limit(f.limit)
        .select(
          'p.id',
          'p.device_id',
          'dv.imei as device_imei',
          'p.vehicle_id',
          'v.name as vehicle_name',
          'p.trigger',
          'p.triggered_at',
          'p.captured_at',
          'p.status',
          'p.error',
          'p.face_status',
          'p.face_score',
          'p.driver_id',
          trx.raw(
            "NULLIF(BTRIM(COALESCE(d.first_name, '') || ' ' || COALESCE(d.last_name, '')), '') AS driver_name",
          ),
          'p.match_status',
          'p.match_score',
          'p.matched_at',
        );
      return (rows as Array<Record<string, unknown>>).map((r) => ({
        id: String(r.id),
        deviceId: String(r.device_id),
        deviceImei: (r.device_imei as string | null) ?? null,
        vehicleId: (r.vehicle_id as string | null) ?? null,
        vehicleName: (r.vehicle_name as string | null) ?? null,
        trigger: r.trigger as DriverPhotoTrigger,
        triggeredAt: asDate(r.triggered_at as Date) as Date,
        capturedAt: asDate(r.captured_at as Date | null),
        status: r.status as DriverPhotoStatus,
        error: (r.error as string | null) ?? null,
        faceStatus: (r.face_status as DriverFaceStatus | null) ?? null,
        faceScore: asNum(r.face_score),
        driverId: (r.driver_id as string | null) ?? null,
        driverName: (r.driver_name as string | null) ?? null,
        matchStatus: r.match_status as DriverMatchStatus,
        matchScore: asNum(r.match_score),
        matchedAt: asDate(r.matched_at as Date | null),
      }));
    });
  }

  public async counts(tenantId: string): Promise<DriverPhotoCounts> {
    return withTenantContext(this.knex, tenantId, async (trx) => {
      const { rows } = await trx.raw<{ rows: Array<Record<string, string>> }>(
        `SELECT
           COUNT(*) FILTER (WHERE status = 'READY' AND match_status = 'UNASSIGNED') AS unassigned,
           COUNT(*) FILTER (WHERE match_status = 'AUTO') AS auto,
           COUNT(*) FILTER (WHERE match_status = 'CONFIRMED') AS confirmed,
           COUNT(*) FILTER (WHERE status IN ('PENDING', 'CAPTURING', 'DOWNLOADING')) AS in_progress,
           COUNT(*) FILTER (WHERE status = 'FAILED') AS failed
         FROM fleet.driver_photos WHERE tenant_id = ?::uuid`,
        [tenantId],
      );
      const r = rows[0] ?? {};
      return {
        unassigned: Number(r.unassigned ?? 0),
        auto: Number(r.auto ?? 0),
        confirmed: Number(r.confirmed ?? 0),
        inProgress: Number(r.in_progress ?? 0),
        failed: Number(r.failed ?? 0),
      };
    });
  }
}
