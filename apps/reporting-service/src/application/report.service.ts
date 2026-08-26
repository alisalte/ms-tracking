import type { TelemetryMetrics } from '@fleetvision/observability';
/**
 * ReportService — Sprint J orchestration: window validation, caching,
 * bounded pagination, CSV assembly, audit + metrics wiring.
 *
 * Pure query composition lives in ReportRepository; this layer adds the
 * cross-cutting rules every report shares (window parsing §16/§18, caching
 * §42/§43, freshness labeling §44, timeouts §46 — inside the repository's
 * transaction wrapper).
 */
import { Logger } from '@nestjs/common';
import type { ReportingConfig } from '../config/reporting.config.js';
import { type CsvValue, csvDocument } from '../domain/csv.js';
import {
  type CursorPage,
  TRIP_SORT_FIELDS,
  UTILIZATION_SORT_FIELDS,
  periodDeltaPct,
  resolveSort,
} from '../domain/report-types.js';
import type { FleetOverview, KpiIndicator, KpiScorecard, SafetyScorecard } from '../domain/report-types.js';
import {
  type ReportWindowError,
  parseReportWindow,
  reportWindowErrorMessage,
} from '../domain/report-window.js';
import { ReportCache } from '../infrastructure/cache/report-cache.js';
import type { ExportRateLimiter } from '../infrastructure/cache/report-cache.js';
import type { ReportRepository } from '../infrastructure/persistence/report.repository.js';

export class ReportInputError extends Error {
  constructor(
    message: string,
    public readonly code: ReportWindowError | 'INVALID_FILTER' | 'INVALID_CURSOR',
  ) {
    super(message);
  }
}

export interface ReportQueryBase {
  preset?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  vehicleId?: string | undefined;
  fleetId?: string | undefined;
}

export interface ReportServiceDeps {
  readonly config: ReportingConfig;
  readonly repository: ReportRepository;
  readonly cache: ReportCache | null;
  readonly exportLimiter: ExportRateLimiter | null;
  readonly audit?: {
    appendBestEffort(entry: {
      tenantId: string;
      actorId: string | null;
      action: string;
      resourceType: string;
      resourceId: string | null;
      outcome: 'SUCCESS' | 'DENIED' | 'ERROR';
      requestId: string | null;
      before: unknown;
      after: unknown;
    }): Promise<void>;
  } | null;
  readonly metrics?: TelemetryMetrics | null;
}

interface Windowed {
  from: Date;
  to: Date;
}

export class ReportService {
  private readonly logger = new Logger('ReportService');
  private readonly metrics: TelemetryMetrics | null;

  constructor(private readonly deps: ReportServiceDeps) {
    this.metrics = deps.metrics ?? null;
  }

  /** Parse + validate the shared window; throws ReportInputError (→ 400). */
  public window(q: ReportQueryBase): Windowed {
    const parsed = parseReportWindow({
      preset: q.preset,
      from: q.from,
      to: q.to,
      maxRangeDays: this.deps.config.REPORT_MAX_RANGE_DAYS,
    });
    if (parsed.error) {
      throw new ReportInputError(
        reportWindowErrorMessage(parsed.error, this.deps.config.REPORT_MAX_RANGE_DAYS),
        parsed.error,
      );
    }
    return parsed.window;
  }

  /** Bounded offset clamp for aggregate pages. */
  public page(limit: unknown, offset: unknown): { limit: number; offset: number } {
    const max = this.deps.config.REPORT_MAX_PAGE_SIZE;
    const l = Math.min(Math.max(Number.parseInt(String(limit ?? 50), 10) || 50, 1), max);
    const o = Math.min(Math.max(Number.parseInt(String(offset ?? '0'), 10) || 0, 0), 50_000);
    return { limit: l, offset: o };
  }

  /** Decode a keyset cursor (base64url JSON) or throw ReportInputError. */
  public cursor<T>(raw: string | undefined): T | null {
    if (!raw) return null;
    try {
      return JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as T;
    } catch {
      throw new ReportInputError('Invalid cursor', 'INVALID_CURSOR');
    }
  }

  public static encodeCursor(value: unknown): string {
    return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
  }

  private async timed<T>(report: string, fn: () => Promise<T>): Promise<T> {
    const start = Date.now();
    try {
      const result = await fn();
      this.metrics?.reportRequests.inc({ report, result: 'ok' });
      return result;
    } catch (err) {
      this.metrics?.reportRequests.inc({ report, result: 'error' });
      throw err;
    } finally {
      this.metrics?.reportDuration.observe({ report }, (Date.now() - start) / 1000);
    }
  }

  /** Fleet overview (§6) — cached ≤ TTL. */
  public async fleetOverview(tenantId: string, q: ReportQueryBase) {
    const win = this.window(q);
    const filter = { vehicleId: q.vehicleId, fleetId: q.fleetId };
    const key = ReportCache.key('overview', tenantId, {
      ...filter,
      from: win.from.toISOString(),
      to: win.to.toISOString(),
    });
    if (this.deps.cache) {
      const hit = await this.deps.cache.get<unknown>(key);
      if (hit) {
        this.metrics?.reportCache.inc({ result: 'hit' });
        return hit;
      }
      this.metrics?.reportCache.inc({ result: 'miss' });
    }
    const data = await this.timed('fleet-overview', () =>
      this.deps.repository.fleetOverview(tenantId, win, filter),
    );
    const payload = {
      ...data,
      from: win.from.toISOString(),
      to: win.to.toISOString(),
      dataAsOf: new Date().toISOString(),
      freshness: 'NEAR_REALTIME' as const,
    };
    await this.deps.cache?.set(key, payload);
    return payload;
  }

  /** Executive KPI scorecard — current window vs the immediately previous equal-length window. */
  public async kpiScorecard(tenantId: string, q: ReportQueryBase): Promise<{
    current: KpiScorecard;
    from: string;
    to: string;
    previousFrom: string;
    previousTo: string;
    dataAsOf: string;
    freshness: 'AGGREGATED';
  }> {
    const win = this.window(q);
    const durationMs = win.to.getTime() - win.from.getTime();
    const prev = { from: new Date(win.from.getTime() - durationMs), to: win.from };
    const filter = { vehicleId: q.vehicleId, fleetId: q.fleetId };
    const [cur, prior] = await Promise.all([
      this.timed('kpi-scorecard', () => this.deps.repository.fleetOverview(tenantId, win, filter)),
      this.timed('kpi-scorecard', () => this.deps.repository.fleetOverview(tenantId, prev, filter)),
    ]);
    return {
      current: { indicators: scorecardIndicators(cur, prior) },
      from: win.from.toISOString(),
      to: win.to.toISOString(),
      previousFrom: prev.from.toISOString(),
      previousTo: prev.to.toISOString(),
      dataAsOf: new Date().toISOString(),
      freshness: 'AGGREGATED',
    };
  }

  public async fleetComparison(tenantId: string, q: ReportQueryBase) {
    const win = this.window(q);
    const items = await this.timed('fleet-comparison', () =>
      this.deps.repository.fleetComparison(tenantId, win),
    );
    return {
      items,
      from: win.from.toISOString(),
      to: win.to.toISOString(),
      dataAsOf: new Date().toISOString(),
      freshness: 'AGGREGATED' as const,
    };
  }

  public async safetyScorecard(tenantId: string, q: ReportQueryBase): Promise<{
    current: SafetyScorecard;
    from: string;
    to: string;
    dataAsOf: string;
    freshness: 'AGGREGATED';
  }> {
    const win = this.window(q);
    const durationMs = win.to.getTime() - win.from.getTime();
    const prev = { from: new Date(win.from.getTime() - durationMs), to: win.from };
    const [cur, prior] = await Promise.all([
      this.timed('safety-scorecard', () => this.deps.repository.safetyCounts(tenantId, win)),
      this.timed('safety-scorecard', () => this.deps.repository.safetyCounts(tenantId, prev)),
    ]);
    return {
      current: { ...cur, previous: prior },
      from: win.from.toISOString(),
      to: win.to.toISOString(),
      dataAsOf: new Date().toISOString(),
      freshness: 'AGGREGATED',
    };
  }

  public async trend(tenantId: string, q: ReportQueryBase) {
    const win = this.window(q);
    const filter = { vehicleId: q.vehicleId, fleetId: q.fleetId };
    const key = ReportCache.key('trend', tenantId, {
      ...filter,
      from: win.from.toISOString(),
      to: win.to.toISOString(),
    });
    if (this.deps.cache) {
      const hit = await this.deps.cache.get<unknown>(key);
      if (hit) {
        this.metrics?.reportCache.inc({ result: 'hit' });
        return hit;
      }
      this.metrics?.reportCache.inc({ result: 'miss' });
    }
    const [distanceTrips, alarms] = await Promise.all([
      this.timed('fleet-overview', () => this.deps.repository.trend(tenantId, win, filter)),
      this.timed('alarm-trend', () => this.deps.repository.alarmTrend(tenantId, win, filter)),
    ]);
    const alarmsByDay = new Map(alarms.map((a) => [a.day, a]));
    const payload = {
      points: distanceTrips.map((p) => ({
        day: p.day,
        distanceKm: p.distanceKm,
        trips: p.trips,
        alarms: p.alarms,
        alarmSpeeding: alarmsByDay.get(p.day)?.speeding ?? 0,
        alarmGeofence: alarmsByDay.get(p.day)?.geofence ?? 0,
        alarmOffline: alarmsByDay.get(p.day)?.offline ?? 0,
        alarmOther: alarmsByDay.get(p.day)?.other ?? 0,
      })),
      from: win.from.toISOString(),
      to: win.to.toISOString(),
      dataAsOf: new Date().toISOString(),
      freshness: 'AGGREGATED' as const,
    };
    await this.deps.cache?.set(key, payload);
    return payload;
  }

  public async vehicleUtilization(tenantId: string, q: ReportQueryBase & { sort?: string }) {
    const win = this.window(q);
    const { field, direction } = resolveSort(q.sort, UTILIZATION_SORT_FIELDS, 'utilization');
    const { limit, offset } = this.page(50, '0');
    const { rows, total } = await this.timed('vehicle-utilization', () =>
      this.deps.repository.vehicleUtilization(
        tenantId,
        win,
        { vehicleId: q.vehicleId, fleetId: q.fleetId },
        { expression: UTILIZATION_SORT_FIELDS[field], direction },
        limit,
        offset,
      ),
    );
    return {
      items: rows,
      total,
      limit,
      offset,
      from: win.from.toISOString(),
      to: win.to.toISOString(),
      freshness: 'AGGREGATED' as const,
    };
  }

  public async distance(
    tenantId: string,
    q: ReportQueryBase & { limit?: unknown; offset?: unknown },
  ) {
    const win = this.window(q);
    const { limit, offset } = this.page(q.limit, q.offset);
    const { rows, total } = await this.timed('distance', () =>
      this.deps.repository.distance(
        tenantId,
        win,
        { vehicleId: q.vehicleId, fleetId: q.fleetId },
        limit,
        offset,
      ),
    );
    return {
      items: rows,
      total,
      limit,
      offset,
      from: win.from.toISOString(),
      to: win.to.toISOString(),
      freshness: 'AGGREGATED' as const,
    };
  }

  public async trips(
    tenantId: string,
    q: ReportQueryBase & { sort?: string; limit?: unknown; cursor?: string },
  ): Promise<CursorPage<unknown> & { sort: string }> {
    const win = this.window(q);
    const { field, direction } = resolveSort(q.sort, TRIP_SORT_FIELDS, 'startedAt');
    const { limit } = this.page(q.limit, '0');
    const cursor = this.cursor<{ startedAt: string; id: string } | null>(q.cursor);
    const { rows, nextCursor } = await this.timed('trips', () =>
      this.deps.repository.trips(
        tenantId,
        win,
        { vehicleId: q.vehicleId, fleetId: q.fleetId },
        { expression: TRIP_SORT_FIELDS[field], direction },
        limit,
        cursor,
      ),
    );
    return {
      items: rows,
      nextCursor: nextCursor ? ReportService.encodeCursor(nextCursor) : null,
      sort: `${field}:${direction.toLowerCase()}`,
    };
  }

  public async speed(tenantId: string, q: ReportQueryBase & { limit?: unknown; offset?: unknown }) {
    const win = this.window(q);
    const { limit, offset } = this.page(q.limit, q.offset);
    const { rows, total } = await this.timed('speed', () =>
      this.deps.repository.speed(
        tenantId,
        win,
        { vehicleId: q.vehicleId, fleetId: q.fleetId },
        limit,
        offset,
      ),
    );
    return {
      items: rows,
      total,
      limit,
      offset,
      from: win.from.toISOString(),
      to: win.to.toISOString(),
      freshness: 'AGGREGATED' as const,
    };
  }

  public async idleParking(
    tenantId: string,
    q: ReportQueryBase & { kind?: string; limit?: unknown; cursor?: string },
  ) {
    const win = this.window(q);
    const kind = q.kind === 'IDLE' || q.kind === 'PARKING' ? q.kind : undefined;
    if (q.kind !== undefined && kind === undefined) {
      throw new ReportInputError('kind must be IDLE or PARKING', 'INVALID_FILTER');
    }
    const { limit } = this.page(q.limit, '0');
    const cursor = this.cursor<{ startedAt: string; id: string } | null>(q.cursor);
    const { rows, nextCursor } = await this.timed('idle-parking', () =>
      this.deps.repository.idleParking(
        tenantId,
        win,
        { vehicleId: q.vehicleId, fleetId: q.fleetId },
        kind,
        limit,
        cursor,
      ),
    );
    return {
      items: rows,
      nextCursor: nextCursor ? ReportService.encodeCursor(nextCursor) : null,
    };
  }

  public async alarms(
    tenantId: string,
    q: ReportQueryBase & { type?: string; severity?: string; limit?: unknown; offset?: unknown },
  ) {
    const win = this.window(q);
    const { limit, offset } = this.page(q.limit, q.offset);
    const { rows, total, summary } = await this.timed('alarms', () =>
      this.deps.repository.alarms(
        tenantId,
        win,
        { vehicleId: q.vehicleId, fleetId: q.fleetId, type: q.type, severity: q.severity },
        limit,
        offset,
      ),
    );
    return {
      items: rows,
      total,
      summary,
      limit,
      offset,
      from: win.from.toISOString(),
      to: win.to.toISOString(),
      freshness: 'AGGREGATED' as const,
    };
  }

  public async alarmTrend(tenantId: string, q: ReportQueryBase) {
    const win = this.window(q);
    const rows = await this.timed('alarm-trend', () =>
      this.deps.repository.alarmTrend(tenantId, win, {
        vehicleId: q.vehicleId,
        fleetId: q.fleetId,
      }),
    );
    return {
      points: rows,
      from: win.from.toISOString(),
      to: win.to.toISOString(),
      freshness: 'AGGREGATED' as const,
    };
  }

  public async geofences(
    tenantId: string,
    q: ReportQueryBase & { geofenceId?: string; limit?: unknown; offset?: unknown },
  ) {
    const win = this.window(q);
    const { limit, offset } = this.page(q.limit, q.offset);
    const { rows, total } = await this.timed('geofences', () =>
      this.deps.repository.geofenceReport(
        tenantId,
        win,
        { geofenceId: q.geofenceId, vehicleId: q.vehicleId },
        limit,
        offset,
      ),
    );
    return {
      items: rows,
      total,
      limit,
      offset,
      from: win.from.toISOString(),
      to: win.to.toISOString(),
      freshness: 'AGGREGATED' as const,
    };
  }

  public async activity(
    tenantId: string,
    q: ReportQueryBase & { limit?: unknown; cursor?: string },
  ) {
    const win = this.window(q);
    const { limit } = this.page(q.limit, '0');
    const cursor = this.cursor<{ at: string; id: string } | null>(q.cursor);
    const { rows, nextCursor } = await this.timed('activity', () =>
      this.deps.repository.activity(tenantId, win, { vehicleId: q.vehicleId }, limit, cursor),
    );
    return {
      items: rows,
      nextCursor: nextCursor ? ReportService.encodeCursor(nextCursor) : null,
    };
  }

  // ── CSV export (§31/§32) ──────────────────────────────────────────────────

  /** Rate-limited + audited CSV export. Returns the full document string. */
  public async exportCsv(
    tenantId: string,
    userId: string | null,
    report: 'trips' | 'vehicle-utilization' | 'alarms',
    q: ReportQueryBase & { sort?: string; type?: string; severity?: string },
  ): Promise<{ csv: string; filename: string; rows: number }> {
    if (this.deps.exportLimiter && userId) {
      const allowed = await this.deps.exportLimiter.allow(tenantId, userId);
      if (!allowed) {
        this.metrics?.reportExports.inc({ result: 'rate_limited' });
        throw new ReportInputError(
          'Export rate limit exceeded — try again shortly',
          'INVALID_FILTER',
        );
      }
    }
    try {
      const maxRows = this.deps.config.REPORT_EXPORT_MAX_ROWS;
      let header: string[];
      let rows: CsvValue[][];
      if (report === 'trips') {
        const collected: CsvValue[][] = [];
        let cursor: string | undefined;
        do {
          const page = (await this.trips(tenantId, { ...q, limit: 200, cursor })) as {
            items: Array<Record<string, unknown>>;
            nextCursor: string | null;
          };
          for (const t of page.items) {
            collected.push([
              String(t.label),
              String(t.startedAt),
              t.endedAt ? String(t.endedAt) : '',
              Number(t.durationSec),
              Number(t.distanceKm),
              t.avgSpeedKph === null || t.avgSpeedKph === undefined ? '' : Number(t.avgSpeedKph),
              Number(t.maxSpeedKph),
              Number(t.idleSec),
              Number(t.parkingSec),
            ]);
          }
          cursor = page.nextCursor ?? undefined;
        } while (cursor && collected.length < maxRows);
        rows = collected.slice(0, maxRows);
        header = [
          'vehicle',
          'started_at_utc',
          'ended_at_utc',
          'duration_s',
          'distance_km',
          'avg_speed_kph',
          'max_speed_kph',
          'idle_s',
          'parking_s',
        ];
      } else if (report === 'vehicle-utilization') {
        const page = await this.vehicleUtilization(tenantId, q);
        header = [
          'vehicle',
          'moving_s',
          'idle_s',
          'parking_s',
          'observed_s',
          'utilization_pct',
          'distance_km',
          'trips',
        ];
        rows = (page.items as unknown as Array<Record<string, unknown>>).map((r) => [
          String(r.label),
          Number(r.movingSec),
          Number(r.idleSec),
          Number(r.parkingSec),
          r.observedSec === null || r.observedSec === undefined ? '' : Number(r.observedSec),
          r.utilizationPct === null || r.utilizationPct === undefined
            ? ''
            : Number(r.utilizationPct),
          Number(r.distanceKm),
          Number(r.trips),
        ]);
      } else {
        const page = await this.alarms(tenantId, { ...q, limit: 200 });
        header = ['vehicle', 'type', 'severity', 'total', 'open', 'acknowledged', 'resolved'];
        rows = (page.items as unknown as Array<Record<string, unknown>>).map((r) => [
          r.label ? String(r.label) : '',
          String(r.type),
          String(r.severity),
          Number(r.total),
          Number(r.open),
          Number(r.acknowledged),
          Number(r.resolved),
        ]);
      }
      const csv = csvDocument(header, rows);
      this.metrics?.reportExports.inc({ result: 'ok' });
      // Audit (§48): action only — never the report contents.
      void this.deps.audit?.appendBestEffort({
        tenantId,
        actorId: userId,
        action: 'report.exported',
        resourceType: 'report',
        resourceId: report,
        outcome: 'SUCCESS',
        requestId: null,
        before: null,
        after: { rows: rows.length },
      });
      this.logger.log(`CSV export ${report} rows=${rows.length} tenant=${tenantId}`);
      return {
        csv,
        filename: `${report}-${new Date().toISOString().slice(0, 10)}.csv`,
        rows: rows.length,
      };
    } catch (err) {
      if (err instanceof ReportInputError) throw err;
      this.metrics?.reportExports.inc({ result: 'error' });
      throw err;
    }
  }
}

function scorecardIndicators(cur: FleetOverview, prior: FleetOverview): KpiIndicator[] {
  const hours = (sec: number) => sec / 3600;
  const pair = (
    key: string,
    value: number | null,
    previousValue: number | null,
    unit: KpiIndicator['unit'],
  ): KpiIndicator => ({
    key,
    value,
    previousValue,
    deltaPct: periodDeltaPct(value, previousValue),
    unit,
  });
  return [
    pair('distanceKm', cur.totalDistanceKm, prior.totalDistanceKm, 'km'),
    pair('trips', cur.totalTrips, prior.totalTrips, 'count'),
    pair('utilizationPct', cur.avgUtilizationPct, prior.avgUtilizationPct, 'pct'),
    pair('movingHours', hours(cur.movingDurationSec), hours(prior.movingDurationSec), 'hours'),
    pair('idleHours', hours(cur.idleDurationSec), hours(prior.idleDurationSec), 'hours'),
    pair('avgSpeedKmh', cur.avgSpeedKmh, prior.avgSpeedKmh, 'kmh'),
    pair('alarms', cur.totalAlarms, prior.totalAlarms, 'count'),
    pair('openAlarms', cur.openAlarms, prior.openAlarms, 'count'),
    pair('speedingEvents', cur.speedingEventCount, prior.speedingEventCount, 'count'),
    pair('geofenceEvents', cur.geofenceEvents, prior.geofenceEvents, 'count'),
  ];
}
