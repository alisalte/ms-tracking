/**
 * Reports & Analytics API + data hooks.
 *
 * The Reports page (Reporting.md §5, Analytics-Reporting.md §3) needs report
 * definitions, jobs, KPIs, chart series, and saved dashboards, plus the
 * generate (async job) + export actions. None of these endpoints exist in the
 * backend yet — so each query resolves from static mock data
 * (`mock/report-data.ts`) with a small latency. The generate/export mutations
 * simulate the async job lifecycle (Reporting §5.2). When the REST endpoints
 * land, swap the mock body for `apiGet`/`apiPost` and the hooks stay unchanged.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { resolveMock, shouldUseMock } from '@/lib/mock-gate';
import { downloadBlob } from '@/lib/video-stream';
import {
  mockChartSeries,
  mockDashboards,
  mockGenerateJob,
  mockKpis,
  mockReportDefinitions,
  mockReportJobs,
} from '@/mock/report-data';
import type {
  Dashboard,
  Kpi,
  MetricSeries,
  ReportDefinition,
  ReportFormat,
  ReportJob,
} from '@/types/report.types';
import { queryKeys } from './query-keys';

// ── Fetchers (reporting/analytics services not built — mock in demo, empty in real) ──

/** GET /api/v1/reports/definitions (no backend; mock-only). */
function fetchDefinitions(): Promise<ReportDefinition[]> {
  if (!shouldUseMock()) return Promise.resolve([]);
  return resolveMock(mockReportDefinitions);
}
/** GET /api/v1/reports/jobs (no backend; mock-only). */
function fetchJobs(): Promise<ReportJob[]> {
  if (!shouldUseMock()) return Promise.resolve([]);
  return resolveMock(mockReportJobs);
}
/** GET /api/v1/analytics/kpis (no backend; mock-only). */
function fetchKpis(): Promise<Kpi[]> {
  if (!shouldUseMock()) return Promise.resolve([]);
  return resolveMock(mockKpis);
}
/** GET /api/v1/analytics/charts (no backend; mock-only). */
function fetchCharts(): Promise<MetricSeries[]> {
  if (!shouldUseMock()) return Promise.resolve([]);
  return resolveMock(mockChartSeries);
}
/** GET /api/v1/analytics/dashboards (no backend; mock-only). */
function fetchDashboards(): Promise<Dashboard[]> {
  if (!shouldUseMock()) return Promise.resolve([]);
  return resolveMock(mockDashboards);
}

// ── Hooks ────────────────────────────────────────────────────────────────────

export function useReportDefinitions() {
  return useQuery({ queryKey: queryKeys.reports.definitions(), queryFn: fetchDefinitions });
}
export function useReportJobs() {
  return useQuery({ queryKey: queryKeys.reports.jobs(), queryFn: fetchJobs });
}
export function useKpis() {
  return useQuery({ queryKey: queryKeys.reports.kpis(), queryFn: fetchKpis });
}
export function useChartSeries() {
  return useQuery({ queryKey: queryKeys.reports.charts(), queryFn: fetchCharts });
}
export function useDashboards() {
  return useQuery({ queryKey: queryKeys.reports.dashboards(), queryFn: fetchDashboards });
}

/**
 * Generate a report on-demand → `POST /api/v1/reports/generate` (Reporting §5.2).
 *
 * The reports backend does not exist yet. In mock/demo mode this simulates the
 * async job lifecycle (pending → running → succeeded) so the Jobs table is
 * demonstrable. In REAL mode it REJECTS honestly (no backend) rather than
 * fabricating a "succeeded" job — callers surface the error instead of a fake
 * success. Swap the mock body for `apiPost` + job polling when the endpoint
 * lands.
 */
export function useGenerateReport() {
  const qc = useQueryClient();
  return useMutation<
    ReportJob,
    Error,
    { definitionId: string; formats: ReportFormat[] },
    { prev: ReportJob[] | undefined }
  >({
    mutationFn: async ({ definitionId, formats }) => {
      if (!shouldUseMock()) {
        // No reporting backend exists — fail honestly instead of faking success.
        throw new Error('Report generation is not available (reports backend not implemented).');
      }
      const { job, artifact } = mockGenerateJob(definitionId, formats);
      // Simulate the pending → running → succeeded transitions.
      await new Promise((r) => setTimeout(r, 600));
      job.status = 'running';
      await artifact();
      job.status = 'succeeded';
      job.completedAt = new Date().toISOString();
      job.artifactUrl = `#/download/${job.id}`;
      return job;
    },
    onMutate: async ({ definitionId, formats }) => {
      const listKey = queryKeys.reports.jobs();
      await qc.cancelQueries({ queryKey: listKey });
      const prev = qc.getQueryData<ReportJob[]>(listKey);
      const pending = mockGenerateJob(definitionId, formats).job;
      qc.setQueryData<ReportJob[]>(listKey, (old) => [pending, ...(old ?? [])]);
      return { prev };
    },
    onSuccess: (job) => {
      qc.setQueryData<ReportJob[]>(queryKeys.reports.jobs(), (old) =>
        (old ?? []).map((j) => (j.id === job.id ? job : j)),
      );
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(queryKeys.reports.jobs(), ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: queryKeys.reports.all }),
  });
}

/**
 * Export raw data → `POST /api/v1/reports/export` (REP-FR-11).
 *
 * Mock/demo: builds a small CSV blob and triggers a download. In REAL mode it
 * REJECTS honestly (no reporting backend yet) instead of producing a fake file.
 */
export function useExportRaw() {
  return useMutation<Blob, Error, { name: string }>({
    mutationFn: async () => {
      if (!shouldUseMock()) {
        throw new Error('Raw export is not available (reports backend not implemented).');
      }
      await new Promise((r) => setTimeout(r, 800));
      const header = 'entity,date,metric,value';
      const rows = Array.from(
        { length: 8 },
        (_, i) => `entity-${i},2026-08-0${i + 1},metric,${Math.random().toFixed(2)}`,
      );
      return new Blob([[header, ...rows].join('\n')], { type: 'text/csv' });
    },
    onSuccess: (blob, { name }) => {
      downloadBlob(blob, `${name}-export.csv`);
    },
  });
}
