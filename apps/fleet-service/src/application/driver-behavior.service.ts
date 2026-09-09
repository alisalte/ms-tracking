/**
 * Driver Behavior — sync alarms → driving_events, compute score, ranking (Sprint 1–2).
 */
import {
  LOW_SCORE_ATTENTION_THRESHOLD,
  computeDriverScore,
  mapAlarmToDrivingEventType,
  DEFAULT_SCORE_PERIOD_DAYS,
} from '../domain/index.js';
import type { DriverRepository } from '../infrastructure/persistence/driver.repository.js';
import type {
  DriverScoreRecord,
  DrivingBehaviorRepository,
  DrivingEventRecord,
} from '../infrastructure/persistence/driving-behavior.repository.js';

export interface DriverScoreView extends DriverScoreRecord {
  previousScore: number | null;
  delta: number | null;
  needsAttention: boolean;
}

export interface DriverRankingRow {
  rank: number;
  driverId: string;
  firstName: string;
  lastName: string;
  status: string;
  score: number;
  harshBrakeCount: number;
  rapidAccelCount: number;
  speedViolationCount: number;
  excessiveIdleCount: number;
  needsAttention: boolean;
  calculatedAt: Date;
}

export class DriverBehaviorService {
  constructor(
    private readonly drivers: DriverRepository,
    private readonly behavior: DrivingBehaviorRepository,
  ) {}

  public defaultPeriod(to = new Date()): { from: Date; to: Date } {
    const from = new Date(to.getTime() - DEFAULT_SCORE_PERIOD_DAYS * 24 * 60 * 60 * 1000);
    return { from, to };
  }

  /** Project notification.alerts into fleet.driving_events for the window. */
  public async syncEvents(
    tenantId: string,
    from: Date,
    to: Date,
  ): Promise<{ inserted: number; skipped: number; unattributed: number }> {
    const alarms = await this.behavior.listBehaviorSourceAlarms(tenantId, from, to);
    let inserted = 0;
    let skipped = 0;
    let unattributed = 0;

    for (const alarm of alarms) {
      const type = mapAlarmToDrivingEventType(alarm.type, alarm.detail);
      if (!type) {
        skipped += 1;
        continue;
      }
      const driverId = await this.drivers.findDriverForVehicleAt(
        tenantId,
        alarm.vehicleId,
        alarm.raisedAt,
      );
      if (!driverId) unattributed += 1;

      const result = await this.behavior.upsertEvent({
        tenantId,
        driverId,
        vehicleId: alarm.vehicleId,
        type,
        severity: alarm.severity,
        sourceAlarmId: alarm.id,
        raisedAt: alarm.raisedAt,
        payload: {
          alarmType: alarm.type,
          message: alarm.message,
          alarmCode: alarm.detail.alarmCode ?? null,
        },
      });
      if (result === 'inserted') inserted += 1;
      else skipped += 1;
    }

    return { inserted, skipped, unattributed };
  }

  public async getScore(
    tenantId: string,
    driverId: string,
    from: Date,
    to: Date,
  ): Promise<DriverScoreView | null> {
    const hasAssignment = await this.drivers.hasAssignmentOverlap(tenantId, driverId, from, to);
    if (!hasAssignment) return null;

    await this.syncEvents(tenantId, from, to);

    const counts = await this.behavior.countAttributedForDriver(tenantId, driverId, from, to);
    const breakdown = computeDriverScore(counts);
    const current = await this.behavior.upsertScore({
      tenantId,
      driverId,
      periodStart: from,
      periodEnd: to,
      breakdown,
      unattributedSkipped: 0,
    });

    const spanMs = Math.max(1, to.getTime() - from.getTime());
    const prevTo = from;
    const prevFrom = new Date(from.getTime() - spanMs);
    let previousScore: number | null = null;
    const prevHas = await this.drivers.hasAssignmentOverlap(tenantId, driverId, prevFrom, prevTo);
    if (prevHas) {
      await this.syncEvents(tenantId, prevFrom, prevTo);
      const prevCounts = await this.behavior.countAttributedForDriver(
        tenantId,
        driverId,
        prevFrom,
        prevTo,
      );
      const prevBreakdown = computeDriverScore(prevCounts);
      const prev = await this.behavior.upsertScore({
        tenantId,
        driverId,
        periodStart: prevFrom,
        periodEnd: prevTo,
        breakdown: prevBreakdown,
        unattributedSkipped: 0,
      });
      previousScore = prev.score;
    }

    const delta = previousScore == null ? null : current.score - previousScore;
    return {
      ...current,
      previousScore,
      delta,
      needsAttention: current.score <= LOW_SCORE_ATTENTION_THRESHOLD,
    };
  }

  public async listEvents(
    tenantId: string,
    driverId: string,
    from: Date,
    to: Date,
  ): Promise<DrivingEventRecord[]> {
    await this.syncEvents(tenantId, from, to);
    return this.behavior.listEventsForDriver(tenantId, driverId, from, to);
  }

  /**
   * Tenant-wide ranking for the period (lowest score first = most at risk).
   * Syncs once, scores every ACTIVE driver with assignment overlap.
   */
  public async listRanking(
    tenantId: string,
    from: Date,
    to: Date,
  ): Promise<DriverRankingRow[]> {
    await this.syncEvents(tenantId, from, to);

    const active = await this.drivers.listActiveIds(tenantId);
    for (const driverId of active) {
      const hasAssignment = await this.drivers.hasAssignmentOverlap(tenantId, driverId, from, to);
      if (!hasAssignment) continue;
      const counts = await this.behavior.countAttributedForDriver(tenantId, driverId, from, to);
      const breakdown = computeDriverScore(counts);
      await this.behavior.upsertScore({
        tenantId,
        driverId,
        periodStart: from,
        periodEnd: to,
        breakdown,
        unattributedSkipped: 0,
      });
    }

    const rows = await this.behavior.listScoresForPeriod(tenantId, from, to);
    const sorted = [...rows].sort((a, b) => {
      if (a.score !== b.score) return a.score - b.score;
      return `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`);
    });

    return sorted.map((r, i) => ({
      rank: i + 1,
      driverId: r.driverId,
      firstName: r.firstName,
      lastName: r.lastName,
      status: r.status,
      score: r.score,
      harshBrakeCount: r.harshBrakeCount,
      rapidAccelCount: r.rapidAccelCount,
      speedViolationCount: r.speedViolationCount,
      excessiveIdleCount: r.excessiveIdleCount,
      needsAttention: r.score <= LOW_SCORE_ATTENTION_THRESHOLD,
      calculatedAt: r.calculatedAt,
    }));
  }
}
