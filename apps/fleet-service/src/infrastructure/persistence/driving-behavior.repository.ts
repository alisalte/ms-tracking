/**
 * Driving behavior persistence — events + period scores (Sprint 1).
 */
import { randomUUID } from 'node:crypto';
import type { Knex } from '@fleetvision/persistence-knex';
import { withTenantContext } from '@fleetvision/persistence-knex';
import type { DrivingEventType } from '../../domain/index.js';
import {
  type DriverScoreBreakdown,
  type DrivingEventCounts,
  emptyCounts,
  tallyEventType,
} from '../../domain/index.js';

export interface DrivingEventRecord {
  id: string;
  tenantId: string;
  driverId: string | null;
  vehicleId: string;
  type: DrivingEventType;
  severity: string;
  sourceAlarmId: string | null;
  raisedAt: Date;
  payload: Record<string, unknown>;
}

export interface DriverScoreRecord {
  id: string;
  tenantId: string;
  driverId: string;
  periodStart: Date;
  periodEnd: Date;
  score: number;
  harshBrakeCount: number;
  rapidAccelCount: number;
  speedViolationCount: number;
  excessiveIdleCount: number;
  unattributedSkipped: number;
  calculatedAt: Date;
  deductions: DriverScoreBreakdown['deductions'];
}

interface DrivingEventRow {
  id: string;
  tenant_id: string;
  driver_id: string | null;
  vehicle_id: string;
  type: DrivingEventType;
  severity: string;
  source_alarm_id: string | null;
  raised_at: Date;
  payload: Record<string, unknown> | string;
}

interface BehaviorAlarmRow {
  id: string;
  type: string;
  severity: string;
  vehicle_id: string | null;
  detail: Record<string, unknown> | string;
  raised_at: Date;
  message: string;
}

export class DrivingBehaviorRepository {
  constructor(private readonly knex: Knex) {}

  /** Source alarms in window for behavior projection (cross-schema read). */
  public async listBehaviorSourceAlarms(
    tenantId: string,
    from: Date,
    to: Date,
  ): Promise<
    Array<{
      id: string;
      type: string;
      severity: string;
      vehicleId: string;
      detail: Record<string, unknown>;
      raisedAt: Date;
      message: string;
    }>
  > {
    return withTenantContext(this.knex, tenantId, async (trx) => {
      const rows = (await trx('notification.alerts')
        .select('id', 'type', 'severity', 'vehicle_id', 'detail', 'raised_at', 'message')
        .where({ tenant_id: tenantId })
        .whereNotNull('vehicle_id')
        .andWhere('raised_at', '>=', from)
        .andWhere('raised_at', '<=', to)
        .andWhere((q) =>
          q
            .whereIn('type', ['overspeed', 'prolonged_idle'])
            .orWhere((q2) =>
              q2
                .where('type', 'collision')
                .andWhereRaw(`detail->>'alarmCode' IN ('BRAKING', 'ACCELERATION')`),
            )
            .orWhereRaw(`detail->>'alarmCode' IN ('BRAKING', 'ACCELERATION', 'OVERSPEED')`),
        )) as BehaviorAlarmRow[];

      return rows
        .filter((r) => r.vehicle_id)
        .map((r) => ({
          id: r.id,
          type: r.type,
          severity: r.severity,
          vehicleId: r.vehicle_id as string,
          detail: typeof r.detail === 'string' ? JSON.parse(r.detail) : (r.detail ?? {}),
          raisedAt: r.raised_at,
          message: r.message,
        }));
    });
  }

  public async upsertEvent(event: {
    tenantId: string;
    driverId: string | null;
    vehicleId: string;
    type: DrivingEventType;
    severity: string;
    sourceAlarmId: string;
    raisedAt: Date;
    payload: Record<string, unknown>;
  }): Promise<'inserted' | 'exists'> {
    return withTenantContext(this.knex, event.tenantId, async (trx) => {
      const existing = await trx('fleet.driving_events')
        .where({ tenant_id: event.tenantId, source_alarm_id: event.sourceAlarmId })
        .first('id');
      if (existing) return 'exists';
      await trx('fleet.driving_events').insert({
        id: randomUUID(),
        tenant_id: event.tenantId,
        driver_id: event.driverId,
        vehicle_id: event.vehicleId,
        type: event.type,
        severity: event.severity,
        source_alarm_id: event.sourceAlarmId,
        raised_at: event.raisedAt,
        payload: JSON.stringify(event.payload),
      });
      return 'inserted';
    });
  }

  public async listEventsForDriver(
    tenantId: string,
    driverId: string,
    from: Date,
    to: Date,
  ): Promise<DrivingEventRecord[]> {
    return withTenantContext(this.knex, tenantId, async (trx) => {
      const rows = (await trx<DrivingEventRow>('fleet.driving_events')
        .where({ tenant_id: tenantId, driver_id: driverId })
        .andWhere('raised_at', '>=', from)
        .andWhere('raised_at', '<=', to)
        .orderBy('raised_at', 'desc')) as DrivingEventRow[];
      return rows.map((r) => this.toEvent(r));
    });
  }

  public async countAttributedForDriver(
    tenantId: string,
    driverId: string,
    from: Date,
    to: Date,
  ): Promise<DrivingEventCounts> {
    const events = await this.listEventsForDriver(tenantId, driverId, from, to);
    const counts = emptyCounts();
    for (const e of events) tallyEventType(counts, e.type);
    return counts;
  }

  public async upsertScore(input: {
    tenantId: string;
    driverId: string;
    periodStart: Date;
    periodEnd: Date;
    breakdown: DriverScoreBreakdown;
    unattributedSkipped: number;
  }): Promise<DriverScoreRecord> {
    return withTenantContext(this.knex, input.tenantId, async (trx) => {
      const existing = await trx('fleet.driver_scores')
        .where({
          tenant_id: input.tenantId,
          driver_id: input.driverId,
          period_start: input.periodStart,
          period_end: input.periodEnd,
        })
        .first('id');

      const row = {
        tenant_id: input.tenantId,
        driver_id: input.driverId,
        period_start: input.periodStart,
        period_end: input.periodEnd,
        score: input.breakdown.score,
        harsh_brake_count: input.breakdown.harshBrake,
        rapid_accel_count: input.breakdown.rapidAccel,
        speed_violation_count: input.breakdown.speedViolation,
        excessive_idle_count: input.breakdown.excessiveIdle,
        unattributed_skipped: input.unattributedSkipped,
        calculated_at: new Date(),
      };

      let id: string;
      if (existing) {
        id = existing.id as string;
        await trx('fleet.driver_scores').where({ id }).update(row);
      } else {
        id = randomUUID();
        await trx('fleet.driver_scores').insert({ id, ...row });
      }

      return {
        id,
        tenantId: input.tenantId,
        driverId: input.driverId,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        score: input.breakdown.score,
        harshBrakeCount: input.breakdown.harshBrake,
        rapidAccelCount: input.breakdown.rapidAccel,
        speedViolationCount: input.breakdown.speedViolation,
        excessiveIdleCount: input.breakdown.excessiveIdle,
        unattributedSkipped: input.unattributedSkipped,
        calculatedAt: row.calculated_at,
        deductions: input.breakdown.deductions,
      };
    });
  }

  public async listScoresForPeriod(
    tenantId: string,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<
    Array<{
      driverId: string;
      firstName: string;
      lastName: string;
      status: string;
      score: number;
      harshBrakeCount: number;
      rapidAccelCount: number;
      speedViolationCount: number;
      excessiveIdleCount: number;
      calculatedAt: Date;
    }>
  > {
    return withTenantContext(this.knex, tenantId, async (trx) => {
      const rows = await trx('fleet.driver_scores as s')
        .join('fleet.drivers as d', function joinDrivers() {
          this.on('d.id', '=', 's.driver_id').andOn('d.tenant_id', '=', 's.tenant_id');
        })
        .where('s.tenant_id', tenantId)
        .andWhere('s.period_start', periodStart)
        .andWhere('s.period_end', periodEnd)
        .select(
          's.driver_id',
          'd.first_name',
          'd.last_name',
          'd.status',
          's.score',
          's.harsh_brake_count',
          's.rapid_accel_count',
          's.speed_violation_count',
          's.excessive_idle_count',
          's.calculated_at',
        )
        .orderBy('s.score', 'asc');

      return (
        rows as Array<{
          driver_id: string;
          first_name: string;
          last_name: string;
          status: string;
          score: number;
          harsh_brake_count: number;
          rapid_accel_count: number;
          speed_violation_count: number;
          excessive_idle_count: number;
          calculated_at: Date;
        }>
      ).map((r) => ({
        driverId: r.driver_id,
        firstName: r.first_name,
        lastName: r.last_name,
        status: r.status,
        score: Number(r.score),
        harshBrakeCount: Number(r.harsh_brake_count),
        rapidAccelCount: Number(r.rapid_accel_count),
        speedViolationCount: Number(r.speed_violation_count),
        excessiveIdleCount: Number(r.excessive_idle_count),
        calculatedAt: r.calculated_at,
      }));
    });
  }

  private toEvent(row: DrivingEventRow): DrivingEventRecord {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      driverId: row.driver_id,
      vehicleId: row.vehicle_id,
      type: row.type,
      severity: row.severity,
      sourceAlarmId: row.source_alarm_id,
      raisedAt: row.raised_at,
      payload: typeof row.payload === 'string' ? JSON.parse(row.payload) : (row.payload ?? {}),
    };
  }
}
