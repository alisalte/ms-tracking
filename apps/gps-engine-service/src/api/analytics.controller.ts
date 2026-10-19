import { CurrentTenant, RequirePermissions } from '@fleetvision/auth';
/**
 * Spatial analytics REST API — fleet-wide grid aggregations over the position
 * history.
 *
 *   GET /positions/analytics/gps-coverage?from=&to=|preset=&cell=&vehicleId=
 *       Per-cell GPS quality (satellites, no-fix, flagged fixes, silent gaps)
 *       with a 0..100 signal score + level — the GPS coverage heatmap.
 *   GET /positions/analytics/movement?from=&to=|preset=&cell=&vehicleId=&tz=
 *       Per-cell activity (moving / stopped time), the derived project area
 *       (hull of the cells holding 95% of activity), a weekday × hour matrix,
 *       and per-vehicle movement summaries — the movement-pattern report.
 *
 * Tenant comes from the verified JWT (`@CurrentTenant()`), never a header.
 * The window reuses the history-window rules (preset XOR from/to, bounded by
 * HISTORY_MAX_RANGE_DAYS); `cell` is clamped to 50..5000 m.
 */
import { Controller, Get, HttpException, HttpStatus, Inject, Query } from '@nestjs/common';
import { historyWindowErrorMessage, parseHistoryWindow } from '../application/history-window.js';
import type { GpsEngineConfig } from '../config/gps-engine.config.js';
import {
  cellBounds,
  cellStepDeg,
  clampCellMeters,
  coverageLevel,
  coverageScore,
  projectArea,
} from '../domain/spatial-analytics.js';
import type {
  AnalyticsQuery,
  PositionAnalyticsRepository,
} from '../infrastructure/persistence/position-analytics.repository.js';
import { GPS_ENGINE_CONFIG, POSITION_ANALYTICS_REPOSITORY } from './tokens.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_TZ = 'Asia/Tehran';

/** Accept only a real IANA zone (it is bound into SQL `AT TIME ZONE`). */
export function resolveTimeZone(raw: string | undefined): string {
  const tz = raw?.trim();
  if (!tz) return DEFAULT_TZ;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    throw new HttpException('tz must be an IANA time zone', HttpStatus.BAD_REQUEST);
  }
}

@Controller('positions/analytics')
export class AnalyticsController {
  constructor(
    @Inject(POSITION_ANALYTICS_REPOSITORY) private readonly repo: PositionAnalyticsRepository,
    @Inject(GPS_ENGINE_CONFIG) private readonly config: GpsEngineConfig,
  ) {}

  @Get('gps-coverage')
  @RequirePermissions('tracking.read')
  public async gpsCoverage(
    @CurrentTenant() tenantId: string,
    @Query('preset') preset?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('cell') cell?: string,
    @Query('vehicleId') vehicleId?: string,
  ) {
    const q = this.query(tenantId, { preset, from, to, cell, vehicleId });
    const rows = await this.repo.coverageCells(q);
    const cells = rows.map((r) => ({
      ...cellBounds(r.gy, r.gx, q.stepDeg),
      ...r,
      score: coverageScore(r),
      level: coverageLevel(r),
    }));
    const totals = cells.reduce(
      (acc, c) => {
        acc.points += c.points;
        acc.weakPoints += c.weakPoints;
        acc.noFixPoints += c.noFixPoints;
        acc.lowQualityPoints += c.lowQualityPoints;
        acc.gaps += c.gaps;
        acc[c.level] += 1;
        return acc;
      },
      {
        points: 0,
        weakPoints: 0,
        noFixPoints: 0,
        lowQualityPoints: 0,
        gaps: 0,
        good: 0,
        fair: 0,
        poor: 0,
        none: 0,
      },
    );
    return {
      from: q.from.toISOString(),
      to: q.to.toISOString(),
      cellMeters: clampCellMeters(cell),
      totals,
      cells,
    };
  }

  @Get('movement')
  @RequirePermissions('tracking.read')
  public async movement(
    @CurrentTenant() tenantId: string,
    @Query('preset') preset?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('cell') cell?: string,
    @Query('vehicleId') vehicleId?: string,
    @Query('tz') tz?: string,
  ) {
    const q = this.query(tenantId, { preset, from, to, cell, vehicleId, tz });
    const [rows, hours, vehicles] = await Promise.all([
      this.repo.movementCells(q),
      this.repo.hourBuckets(q),
      this.repo.vehicleSummaries(q),
    ]);
    const cells = rows.map((r) => ({ ...cellBounds(r.gy, r.gx, q.stepDeg), ...r }));
    const area = projectArea(
      rows.map((r) => ({ gy: r.gy, gx: r.gx, weight: r.movingSec + r.stoppedSec || r.points })),
      q.stepDeg,
    );
    const stopHotspots = [...cells]
      .filter((c) => c.stoppedSec > 0)
      .sort((a, b) => b.stoppedSec - a.stoppedSec)
      .slice(0, 10);
    return {
      from: q.from.toISOString(),
      to: q.to.toISOString(),
      cellMeters: clampCellMeters(cell),
      timeZone: q.timeZone,
      area,
      cells,
      hours,
      stopHotspots,
      vehicles,
    };
  }

  private query(
    tenantId: string,
    p: {
      preset?: string;
      from?: string;
      to?: string;
      cell?: string;
      vehicleId?: string;
      tz?: string;
    },
  ): AnalyticsQuery {
    const parsed = parseHistoryWindow({
      preset: p.preset,
      from: p.from,
      to: p.to,
      maxRangeDays: this.config.HISTORY_MAX_RANGE_DAYS,
    });
    if (parsed.error) {
      throw new HttpException(
        historyWindowErrorMessage(parsed.error, this.config.HISTORY_MAX_RANGE_DAYS),
        HttpStatus.BAD_REQUEST,
      );
    }
    const vehicleId = p.vehicleId?.trim() || undefined;
    if (vehicleId && !UUID_RE.test(vehicleId)) {
      throw new HttpException('vehicleId must be a UUID', HttpStatus.BAD_REQUEST);
    }
    return {
      tenantId,
      from: parsed.window.fromTime,
      to: parsed.window.toTime,
      stepDeg: cellStepDeg(clampCellMeters(p.cell)),
      vehicleId,
      timeZone: resolveTimeZone(p.tz),
    };
  }
}
