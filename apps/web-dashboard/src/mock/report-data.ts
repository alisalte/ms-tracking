import type {
  Dashboard,
  Kpi,
  MetricSeries,
  ReportCategory,
  ReportDefinition,
  ReportFormat,
  ReportJob,
  ReportJobStatus,
} from '@/types/report.types';
/**
 * Static mock report + analytics data — the Reports page's single demo source.
 *
 * KPIs and chart series reference the existing dashboard mock values
 * (`mockFleetStats`, `mockActivity`, `mockUtilization`) so numbers stay
 * consistent across the Fleet Dashboard and Reports surfaces. When the
 * `reporting-service` + `analytics-engine` REST endpoints land,
 * `api/report.api.ts` swaps these constants for `apiGet` calls + wire→camelCase
 * mapping — the types and UI stay unchanged.
 */
import { mockActivity, mockUtilization } from './fleet-data';

/** Tiny deterministic PRNG (mulberry32) — no Math.random so tests are stable. */
function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Report definitions (Reporting §1.3 catalog) ──────────────────────────────

/** Build the builtin report catalog across the 8 categories. */
function buildDefinitions(): ReportDefinition[] {
  const def = (
    id: string,
    name: string,
    category: ReportCategory,
    description: string,
    formats: ReportFormat[],
    isRegulatory = false,
  ): ReportDefinition => ({
    id,
    name,
    category,
    description,
    isRegulatory,
    isBuiltin: true,
    formats,
  });
  return [
    def('rpt-util', 'Daily Utilization', 'operational', 'Per-vehicle driving/idle/stopped hours', [
      'PDF',
      'XLSX',
      'CSV',
    ]),
    def('rpt-idle', 'Idle Summary', 'operational', 'Excess-idle events with cost impact', [
      'XLSX',
      'CSV',
    ]),
    def('rpt-trip', 'Trip Log', 'operational', 'All trips with waypoints + events', [
      'PDF',
      'XLSX',
    ]),
    def('rpt-safety', 'Safety Scorecard', 'safety', 'Driver behavior scores + coaching actions', [
      'PDF',
      'XLSX',
    ]),
    def(
      'rpt-hos',
      'HOS Compliance',
      'compliance',
      'Hours-of-service violations (FMCSA)',
      ['PDF', 'XLSX'],
      true,
    ),
    def(
      'rpt-dvir',
      'DVIR Log',
      'compliance',
      'Driver vehicle inspection records',
      ['PDF', 'CSV'],
      true,
    ),
    def(
      'rpt-ifta',
      'IFTA Quarterly',
      'compliance',
      'Fuel tax jurisdiction report',
      ['PDF', 'XLSX'],
      true,
    ),
    def('rpt-dtc', 'DTC Summary', 'maintenance', 'Diagnostic trouble codes by vehicle', [
      'XLSX',
      'CSV',
    ]),
    def('rpt-fuel', 'Fuel Efficiency', 'fuel', 'MPG trends + fraud review', ['PDF', 'XLSX']),
    def('rpt-tco', 'TCO Breakdown', 'financial', 'Total cost of ownership per vehicle', [
      'PDF',
      'XLSX',
    ]),
    def('rpt-asset', 'Asset Register', 'asset', 'Full vehicle/device lifecycle status', [
      'XLSX',
      'CSV',
    ]),
    def('rpt-kpi', 'KPI Scorecard', 'executive', 'Executive KPI overview + fleet comparison', [
      'PDF',
    ]),
  ];
}

export const mockReportDefinitions: ReportDefinition[] = buildDefinitions();

// ── KPIs (Analytics §3.3) ─────────────────────────────────────────────────────

export const mockKpis: Kpi[] = [
  {
    id: 'kpi-util',
    name: 'Fleet Utilization',
    unit: '%',
    value: mockUtilization.utilization,
    target: 75,
    warningThreshold: 65,
    criticalThreshold: 55,
    trend: 3,
    trendDirection: 'up',
    higherIsBetter: true,
  },
  {
    id: 'kpi-mpg',
    name: 'Fleet MPG',
    unit: 'mpg',
    value: 7.4,
    target: 8,
    warningThreshold: 7,
    criticalThreshold: 6,
    trend: -0.2,
    trendDirection: 'down',
    higherIsBetter: true,
  },
  {
    id: 'kpi-safety',
    name: 'Safety Score',
    unit: '/100',
    value: 82,
    target: 85,
    warningThreshold: 75,
    criticalThreshold: 65,
    trend: 2,
    trendDirection: 'up',
    higherIsBetter: true,
  },
  {
    id: 'kpi-ontime',
    name: 'On-time Delivery',
    unit: '%',
    value: 94,
    target: 95,
    warningThreshold: 90,
    criticalThreshold: 85,
    trend: 1,
    trendDirection: 'up',
    higherIsBetter: true,
  },
  {
    id: 'kpi-costkm',
    name: 'Cost per km',
    unit: '$/km',
    value: 0.42,
    target: 0.38,
    warningThreshold: 0.45,
    criticalThreshold: 0.5,
    trend: -0.01,
    trendDirection: 'down',
    higherIsBetter: false,
  },
];

// ── Chart series (Analytics §3.3 MetricSeries) ───────────────────────────────

const ACTIVITY_COLORS = { driving: '#16A34A', idle: '#F59E0B', stopped: '#64748B' };

export const mockChartSeries: MetricSeries[] = [
  {
    id: 'chart-activity',
    kind: 'area',
    titleKey: 'reports.charts.activity',
    series: [
      { key: 'driving', color: ACTIVITY_COLORS.driving, labelKey: 'dashboard.states.driving' },
      { key: 'idle', color: ACTIVITY_COLORS.idle, labelKey: 'dashboard.states.idle' },
      { key: 'stopped', color: ACTIVITY_COLORS.stopped, labelKey: 'dashboard.states.stopped' },
    ],
    data: mockActivity.map((b) => ({
      label: `${String(b.hour).padStart(2, '0')}:00`,
      driving: b.driving,
      idle: b.idle,
      stopped: b.stopped,
    })) as never, // multi-key points (driving/idle/stopped) — the area chart reads them
  },
  {
    id: 'chart-utilization',
    kind: 'donut',
    titleKey: 'reports.charts.utilization',
    data: mockUtilization.breakdown.map((b) => ({
      label: b.state,
      value: b.percent,
    })),
  },
  {
    id: 'chart-behavior',
    kind: 'bar',
    titleKey: 'reports.charts.behavior',
    data: [
      { label: 'Harsh brake', value: 42 },
      { label: 'Harsh corner', value: 28 },
      { label: 'Overspeed', value: 67 },
      { label: 'Idle', value: 35 },
      { label: 'FCW', value: 19 },
    ],
  },
  {
    id: 'chart-fuel',
    kind: 'line',
    titleKey: 'reports.charts.fuel',
    data: [
      { label: 'Mon', value: 7.1 },
      { label: 'Tue', value: 7.3 },
      { label: 'Wed', value: 7.2 },
      { label: 'Thu', value: 7.5 },
      { label: 'Fri', value: 7.6 },
      { label: 'Sat', value: 7.4 },
      { label: 'Sun', value: 7.4 },
    ],
  },
];

// ── Report jobs (Reporting §4.2) ─────────────────────────────────────────────

const JOB_STATUSES: ReportJobStatus[] = [
  'succeeded',
  'succeeded',
  'succeeded',
  'running',
  'pending',
  'failed',
  'cancelled',
  'succeeded',
];

function buildJobs(): ReportJob[] {
  const rand = seeded(20260814);
  const now = Date.now();
  return JOB_STATUSES.map((status, i) => {
    const def = mockReportDefinitions[i % mockReportDefinitions.length];
    if (!def) throw new Error('no definition');
    const createdAt = new Date(now - i * 3 * 3600_000).toISOString();
    const succeeded = status === 'succeeded' || status === 'failed';
    return {
      id: `job-${5000 + i}`,
      definitionId: def.id,
      definitionName: def.name,
      status,
      formats: def.formats.slice(0, 1 + Math.floor(rand() * 2)),
      dateFrom: new Date(now - 30 * 86_400_000).toISOString(),
      dateTo: new Date(now - i * 3 * 3600_000).toISOString(),
      createdAt,
      completedAt: succeeded ? new Date(now - i * 3 * 3600_000 + 15_000).toISOString() : undefined,
      artifactUrl: status === 'succeeded' ? `#/download/${def.id}/${i}` : undefined,
      hash:
        status === 'succeeded' && def.isRegulatory
          ? `sha256:${Math.random().toString(16).slice(2)}`
          : undefined,
    };
  });
}

export const mockReportJobs: ReportJob[] = buildJobs();

// ── Dashboards (Analytics §3.1) ──────────────────────────────────────────────

export const mockDashboards: Dashboard[] = [
  {
    id: 'dash-overview',
    name: 'Fleet Overview',
    description: 'Headline KPIs + fleet activity',
    sharedWithCount: 5,
    createdAt: '2026-07-01T00:00:00Z',
    widgets: [
      { id: 'w-kpis', type: 'kpi', titleKey: 'reports.kpiRow', span: 12 },
      {
        id: 'w-activity',
        type: 'chart',
        titleKey: 'reports.charts.activity',
        span: 8,
        metricId: 'chart-activity',
      },
      {
        id: 'w-util',
        type: 'chart',
        titleKey: 'reports.charts.utilization',
        span: 4,
        metricId: 'chart-utilization',
      },
      {
        id: 'w-behavior',
        type: 'chart',
        titleKey: 'reports.charts.behavior',
        span: 6,
        metricId: 'chart-behavior',
      },
      {
        id: 'w-fuel',
        type: 'chart',
        titleKey: 'reports.charts.fuel',
        span: 6,
        metricId: 'chart-fuel',
      },
    ],
  },
  {
    id: 'dash-safety',
    name: 'Safety & Compliance',
    description: 'Behavior, HOS, and incident trends',
    sharedWithCount: 3,
    createdAt: '2026-06-20T00:00:00Z',
    widgets: [
      { id: 'w-safety-kpi', type: 'kpi', titleKey: 'reports.kpiRow', span: 12 },
      {
        id: 'w-behavior2',
        type: 'chart',
        titleKey: 'reports.charts.behavior',
        span: 12,
        metricId: 'chart-behavior',
      },
    ],
  },
  {
    id: 'dash-fuel',
    name: 'Fuel & Cost',
    description: 'Efficiency + cost-per-km trends',
    sharedWithCount: 2,
    createdAt: '2026-06-10T00:00:00Z',
    widgets: [
      { id: 'w-fuel-kpi', type: 'kpi', titleKey: 'reports.kpiRow', span: 12 },
      {
        id: 'w-fuel2',
        type: 'chart',
        titleKey: 'reports.charts.fuel',
        span: 12,
        metricId: 'chart-fuel',
      },
    ],
  },
];

/** Resolve a chart series by id. */
export function mockChartSeriesById(id: string): MetricSeries | undefined {
  return mockChartSeries.find((s) => s.id === id);
}

/**
 * Simulate the async generate-job lifecycle (Reporting §5.2).
 *
 * Returns a job that transitions pending → running → succeeded over ~2s so the
 * Jobs table exercises the full state machine. The artifact is a real CSV blob
 * the UI can download.
 */
export function mockGenerateJob(
  definitionId: string,
  formats: ReportFormat[],
): { job: ReportJob; artifact: () => Promise<Blob> } {
  const def = mockReportDefinitions.find((d) => d.id === definitionId);
  const job: ReportJob = {
    id: `job-${Date.now()}`,
    definitionId,
    definitionName: def?.name ?? 'Report',
    status: 'pending',
    formats,
    dateFrom: new Date(Date.now() - 30 * 86_400_000).toISOString(),
    dateTo: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  };
  const artifact = async () => {
    // Simulate render latency, then return a small CSV.
    await new Promise((r) => setTimeout(r, 1500));
    const header = 'vehicle,date,metric,value';
    const rows = ['Truck-101,2026-08-01,utilization,0.73', 'Truck-102,2026-08-01,utilization,0.68'];
    return new Blob([[header, ...rows].join('\n')], { type: 'text/csv' });
  };
  return { job, artifact };
}
