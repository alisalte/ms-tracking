/**
 * Reports & Analytics domain types (UI-facing, camelCase).
 *
 * Mirrors the entity models from `docs/modules/Reporting.md` (report types
 * §1.3, ReportDefinition §4.1, ReportJob §4.2, ReportSchedule §4.3) and
 * `docs/modules/Analytics-Reporting.md` (Dashboard §3.1, KPIDefinition §3.3,
 * MetricSeries). The wire (`*Wire`) snake_case variants will be added here when
 * the `reporting-service` + `analytics-engine` REST endpoints land; today the
 * Reports page reads from static mock data (`mock/report-data.ts`) so the UI is
 * fully demoable.
 *
 * Color semantics live in `theme/palette.ts` (`status.*`); the threshold/trend
 * keys map to those tokens so the UI never hardcodes hex values.
 */

// ── Reports (Reporting.md) ───────────────────────────────────────────────────

/** Report category — the 8 catalog families (Reporting §1.3). */
export type ReportCategory =
  | 'operational'
  | 'safety'
  | 'compliance'
  | 'maintenance'
  | 'fuel'
  | 'financial'
  | 'asset'
  | 'executive';

/** Output format (Reporting §1.4 REP-FR-03). */
export type ReportFormat = 'PDF' | 'XLSX' | 'CSV' | 'HTML';

/** ReportJob lifecycle status (Reporting §4.2 state machine). */
export type ReportJobStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled';

/** A report definition / template (Reporting §4.1 ReportDefinition, UI subset). */
export interface ReportDefinition {
  id: string;
  name: string;
  category: ReportCategory;
  description: string;
  /** Regulatory reports are immutable + hash-signed (REP-BR-02). */
  isRegulatory: boolean;
  /** Builtin templates are tenant-agnostic system seeds. */
  isBuiltin: boolean;
  formats: ReportFormat[];
}

/** A report generation job (Reporting §4.2 ReportJob, UI subset). */
export interface ReportJob {
  id: string;
  definitionId: string;
  definitionName: string;
  status: ReportJobStatus;
  formats: ReportFormat[];
  /** Date range the report covers (ISO). */
  dateFrom: string;
  dateTo: string;
  /** ISO creation timestamp. */
  createdAt: string;
  /** ISO completion timestamp (when SUCCEEDED/FAILED). */
  completedAt?: string;
  /** Artifact download URL (signed S3, when SUCCEEDED). */
  artifactUrl?: string;
  /** Integrity hash (regulatory reports, REP-BR-02). */
  hash?: string;
}

// ── KPIs & Charts (Analytics-Reporting.md §3.3) ──────────────────────────────

/** Direction of the trend vs the previous period. */
export type TrendDirection = 'up' | 'down' | 'flat';

/** A KPI definition + current value (Analytics §3.3 KPIDefinition, UI subset). */
export interface Kpi {
  id: string;
  name: string;
  unit: string;
  value: number;
  /** Desired target (Analytics §3.3 target_value). */
  target?: number;
  /** Warning threshold (Analytics §3.3 warning_threshold). */
  warningThreshold?: number;
  /** Critical threshold (Analytics §3.3 critical_threshold). */
  criticalThreshold?: number;
  /** Signed change vs previous period. */
  trend: number;
  trendDirection: TrendDirection;
  /** Whether a higher value is better (affects trend color). */
  higherIsBetter: boolean;
}

/** A chart-viz data series (Analytics §3.3 MetricSeries, UI subset). */
export interface MetricPoint {
  label: string;
  value: number;
}
export interface MetricSeries {
  id: string;
  /** Chart kind — selects the Recharts component. */
  kind: 'area' | 'donut' | 'bar' | 'line';
  /** i18n key for the chart title. */
  titleKey: string;
  data: MetricPoint[];
  /** For multi-series (area/bar), the breakdown keys. */
  series?: Array<{ key: string; color: string; labelKey: string }>;
}

// ── Dashboards (Analytics-Reporting.md §3.1) ─────────────────────────────────

/** Widget kind on a saved dashboard. */
export type WidgetType = 'kpi' | 'chart' | 'table';

/** A widget placement on a dashboard layout (Analytics §3.1 WidgetPlacement). */
export interface WidgetPlacement {
  id: string;
  type: WidgetType;
  /** i18n key or literal title. */
  titleKey: string;
  /** Column span (1–12 grid). */
  span: number;
  /** For chart widgets, the MetricSeries id. */
  metricId?: string;
}

/** A saved dashboard (Analytics §3.1 Dashboard, UI subset). */
export interface Dashboard {
  id: string;
  name: string;
  description: string;
  widgets: WidgetPlacement[];
  /** Number of users the dashboard is shared with. */
  sharedWithCount: number;
  createdAt: string;
}
