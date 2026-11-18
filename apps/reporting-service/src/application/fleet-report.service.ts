/**
 * FleetReportService — fleet-wide tabular reports (high speeds, mileage,
 * temperature out of range) and their .xlsx exports.
 *
 * Window / filter validation follows ReportService (same presets, same max
 * range, same 400s); the grouping lives in domain/fleet-reports.ts.
 */
import { Logger } from '@nestjs/common';
import type { ReportingConfig } from '../config/reporting.config.js';
import type { CsvLocale } from '../domain/csv-locale.js';
import { csvDocument } from '../domain/csv.js';
import {
  type OverspeedEpisodeRow,
  type TemperatureBounds,
  type TemperatureEpisodeRow,
  buildMileageReport,
  fleetOverspeedEpisodes,
  mileageSheet,
  objectCells,
  objectsHeader,
  objectsSheet,
  overspeedSheet,
  parseTemperatureBounds,
  temperatureSheet,
} from '../domain/fleet-reports.js';
import { parseReportWindow, reportWindowErrorMessage } from '../domain/report-window.js';
import { type SheetSpec, buildXlsxWorkbook } from '../domain/xlsx.js';
import type { ExportRateLimiter } from '../infrastructure/cache/report-cache.js';
import type { FleetReportRepository } from '../infrastructure/persistence/fleet-report.repository.js';
import { UUID_RE } from '../infrastructure/persistence/report.repository.js';
import { ReportInputError } from './report.service.js';

/** Default limit of the high-speed report (km/h). */
export const OVERSPEED_DEFAULT_LIMIT_KMH = 90;
/** Over-limit fixes read for one fleet-wide request. */
const OVERSPEED_FIX_CAP = 100_000;
/** Out-of-range periods returned by one request. */
const TEMPERATURE_EPISODE_CAP = 20_000;

export const FLEET_REPORTS = ['overspeed', 'mileage', 'temperature', 'objects'] as const;
export type FleetReportId = (typeof FLEET_REPORTS)[number];

export interface FleetReportQuery {
  preset?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  vehicleId?: string | undefined;
  fleetId?: string | undefined;
  limitKmh?: unknown;
  minDurationSec?: unknown;
  hideZero?: unknown;
  minC?: unknown;
  maxC?: unknown;
}

export interface FleetReportServiceDeps {
  readonly config: ReportingConfig;
  readonly repository: FleetReportRepository;
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
}

export class FleetReportService {
  private readonly logger = new Logger('FleetReportService');

  constructor(private readonly deps: FleetReportServiceDeps) {}

  /** High speeds: every speeding run of every vehicle in scope. */
  public async overspeed(tenantId: string, q: FleetReportQuery) {
    const win = this.window(q);
    const filter = this.filter(q);
    const limitKmh = this.number(q.limitKmh, OVERSPEED_DEFAULT_LIMIT_KMH, 1, 250, 'limitKmh');
    const minDurationSec = this.number(q.minDurationSec, 0, 0, 86_400, 'minDurationSec');
    const data = await this.deps.repository.overspeedFixes(
      tenantId,
      win,
      filter,
      limitKmh,
      OVERSPEED_FIX_CAP,
    );
    const { rows, discarded } = fleetOverspeedEpisodes(data.vehicles, data.fixes, data.context, {
      limitKmh,
      minDurationSec,
    });
    const vehiclesWithEpisodes = new Set(rows.map((r) => r.vehicleId)).size;
    return {
      from: win.from.toISOString(),
      to: win.to.toISOString(),
      limitKmh,
      minDurationSec,
      truncated: data.truncated,
      summary: {
        episodeCount: rows.length,
        vehicleCount: vehiclesWithEpisodes,
        maxSpeedKmh: rows.length > 0 ? Math.max(...rows.map((r) => r.maxSpeedKmh)) : null,
        totalDurationSec: rows.reduce((s, r) => s + r.durationSec, 0),
        discardedFixCount: discarded,
      },
      items: rows,
    };
  }

  /** Mileage: km per vehicle, grouped by fleet with subtotals and a grand total. */
  public async mileage(tenantId: string, q: FleetReportQuery) {
    const win = this.window(q);
    const rows = await this.deps.repository.mileage(tenantId, win, this.filter(q));
    const hideZero = q.hideZero === true || q.hideZero === 'true' || q.hideZero === '1';
    return {
      from: win.from.toISOString(),
      to: win.to.toISOString(),
      hideZero,
      ...buildMileageReport(rows, { hideZero }),
    };
  }

  /** Temperature: every period a probe read outside the allowed band. */
  public async temperature(tenantId: string, q: FleetReportQuery) {
    const win = this.window(q);
    const filter = this.filter(q);
    const bounds = this.bounds(q);
    const minDurationSec = this.number(q.minDurationSec, 0, 0, 86_400, 'minDurationSec');
    const data = await this.deps.repository.temperature(
      tenantId,
      win,
      filter,
      bounds,
      minDurationSec,
      TEMPERATURE_EPISODE_CAP,
    );
    const vehicle = new Map(data.vehicles.map((v) => [v.vehicleId, v]));
    const seqByVehicle = new Map<string, number>();
    const items: TemperatureEpisodeRow[] = data.episodes
      .map((e) => ({ e, v: vehicle.get(e.vehicleId) }))
      .sort(
        (a, b) =>
          (a.v?.label ?? '').localeCompare(b.v?.label ?? '', 'en', { numeric: true }) ||
          a.e.startedAt.getTime() - b.e.startedAt.getTime(),
      )
      .map(({ e, v }) => {
        const seq = (seqByVehicle.get(e.vehicleId) ?? 0) + 1;
        seqByVehicle.set(e.vehicleId, seq);
        return {
          vehicleId: e.vehicleId,
          label: v?.label ?? e.vehicleId,
          fleetName: v?.fleetName ?? null,
          sensor: e.sensor,
          seq,
          kind: e.kind,
          startedAt: e.startedAt.toISOString(),
          endedAt: e.endedAt.toISOString(),
          durationSec: Math.round((e.endedAt.getTime() - e.startedAt.getTime()) / 1000),
          minC: e.minC,
          maxC: e.maxC,
          avgC: e.avgC,
          readings: e.readings,
          start: { lat: e.startLat, lng: e.startLng },
        };
      });
    return {
      from: win.from.toISOString(),
      to: win.to.toISOString(),
      minC: bounds.minC,
      maxC: bounds.maxC,
      minDurationSec,
      truncated: data.truncated,
      summary: {
        episodeCount: items.length,
        vehicleCount: seqByVehicle.size,
        vehiclesWithSensors: new Set(data.sensors.map((s) => s.vehicleId)).size,
        totalDurationSec: items.reduce((s, r) => s + r.durationSec, 0),
        highestC: items.length > 0 ? Math.max(...items.map((r) => r.maxC)) : null,
        lowestC: items.length > 0 ? Math.min(...items.map((r) => r.minC)) : null,
      },
      sensors: data.sensors,
      items,
    };
  }

  /** Objects: every vehicle with its tracker and newest fix (legacy objects list). */
  public async objects(tenantId: string, q: FleetReportQuery) {
    const rows = await this.deps.repository.objects(tenantId, this.filter(q));
    rows.sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));
    const now = Date.now();
    const age = (iso: string | null) => (iso ? now - Date.parse(iso) : Number.POSITIVE_INFINITY);
    return {
      asOf: new Date(now).toISOString(),
      summary: {
        total: rows.length,
        online: rows.filter((r) => r.connection === 'ONLINE').length,
        moving: rows.filter((r) => (r.speedKmh ?? 0) > 3 && age(r.lastFixAt) < 600_000).length,
        noFix: rows.filter((r) => r.lastFixAt === null).length,
        silent24h: rows.filter((r) => r.lastFixAt !== null && age(r.lastFixAt) > 86_400_000).length,
      },
      items: rows,
    };
  }

  /** CSV of the objects list in the legacy column order (UTF-8 with BOM). */
  public async objectsCsv(
    tenantId: string,
    userId: string | null,
    q: FleetReportQuery,
    locale: CsvLocale,
  ): Promise<{ csv: string; filename: string }> {
    await this.allowExport(tenantId, userId);
    const r = await this.objects(tenantId, q);
    this.audited(tenantId, userId, 'objects', r.items.length, 'csv');
    return {
      csv: csvDocument(
        objectsHeader(locale),
        r.items.map((row) => objectCells(row, locale)),
      ),
      filename: `objects-${new Date().toISOString().slice(0, 10)}.csv`,
    };
  }

  /** .xlsx of one report, rate-limited and audited like the CSV exports. */
  public async workbook(
    tenantId: string,
    userId: string | null,
    report: string,
    q: FleetReportQuery,
    locale: CsvLocale,
  ): Promise<{ bytes: Uint8Array; filename: string }> {
    if (!(FLEET_REPORTS as readonly string[]).includes(report)) {
      throw new ReportInputError(`report must be ${FLEET_REPORTS.join(' | ')}`, 'INVALID_FILTER');
    }
    await this.allowExport(tenantId, userId);
    let sheet: SheetSpec;
    let rowCount: number;
    if (report === 'overspeed') {
      const r = await this.overspeed(tenantId, q);
      sheet = overspeedSheet(
        r.items as OverspeedEpisodeRow[],
        { from: new Date(r.from), to: new Date(r.to) },
        r.limitKmh,
        locale,
      );
      rowCount = r.items.length;
    } else if (report === 'mileage') {
      const r = await this.mileage(tenantId, q);
      sheet = mileageSheet(r, { from: new Date(r.from), to: new Date(r.to) }, locale);
      rowCount = r.vehicleCount;
    } else if (report === 'objects') {
      const r = await this.objects(tenantId, q);
      sheet = objectsSheet(r.items, locale);
      rowCount = r.items.length;
    } else {
      const r = await this.temperature(tenantId, q);
      sheet = temperatureSheet(
        r.items,
        { from: new Date(r.from), to: new Date(r.to) },
        { minC: r.minC, maxC: r.maxC },
        locale,
      );
      rowCount = r.items.length;
    }
    this.audited(tenantId, userId, report, rowCount, 'xlsx');
    return {
      bytes: buildXlsxWorkbook([sheet]),
      filename: `${report}-${new Date().toISOString().slice(0, 10)}.xlsx`,
    };
  }

  private async allowExport(tenantId: string, userId: string | null): Promise<void> {
    if (!this.deps.exportLimiter || !userId) return;
    if (!(await this.deps.exportLimiter.allow(tenantId, userId))) {
      throw new ReportInputError(
        'Export rate limit exceeded — try again shortly',
        'INVALID_FILTER',
      );
    }
  }

  /** Audit (action only — never the report contents). */
  private audited(
    tenantId: string,
    userId: string | null,
    report: string,
    rows: number,
    format: 'xlsx' | 'csv',
  ): void {
    void this.deps.audit?.appendBestEffort({
      tenantId,
      actorId: userId,
      action: 'report.exported',
      resourceType: 'report',
      resourceId: report,
      outcome: 'SUCCESS',
      requestId: null,
      before: null,
      after: { rows, format },
    });
    this.logger.log(`${format.toUpperCase()} export ${report} rows=${rows} tenant=${tenantId}`);
  }

  // ── input ──────────────────────────────────────────────────────────────────

  private window(q: FleetReportQuery) {
    const max = this.deps.config.REPORT_MAX_RANGE_DAYS;
    const parsed = parseReportWindow({
      preset: q.preset,
      from: q.from,
      to: q.to,
      maxRangeDays: max,
    });
    if (parsed.error) {
      throw new ReportInputError(reportWindowErrorMessage(parsed.error, max), parsed.error);
    }
    return parsed.window;
  }

  private filter(q: FleetReportQuery) {
    for (const [name, value] of [
      ['vehicleId', q.vehicleId],
      ['fleetId', q.fleetId],
    ] as const) {
      if (value !== undefined && value !== '' && !UUID_RE.test(value)) {
        throw new ReportInputError(`${name} must be a UUID`, 'INVALID_FILTER');
      }
    }
    return { vehicleId: q.vehicleId || undefined, fleetId: q.fleetId || undefined };
  }

  private number(raw: unknown, fallback: number, min: number, max: number, name: string): number {
    if (raw === undefined || raw === null || raw === '') return fallback;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < min || n > max) {
      throw new ReportInputError(`${name} must be between ${min} and ${max}`, 'INVALID_FILTER');
    }
    return n;
  }

  private bounds(q: FleetReportQuery): TemperatureBounds {
    const parsed = parseTemperatureBounds(q.minC, q.maxC);
    if (parsed.error) {
      const message =
        parsed.error === 'MISSING'
          ? 'minC or maxC is required'
          : parsed.error === 'REVERSED'
            ? 'minC must not exceed maxC'
            : 'minC / maxC must be numbers between -100 and 200';
      throw new ReportInputError(message, 'INVALID_FILTER');
    }
    return parsed.bounds;
  }
}
