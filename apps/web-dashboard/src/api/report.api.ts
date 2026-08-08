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
import { resolveMock } from '@/lib/mock-gate';


// ── Fetchers (swap mock → apiGet when backends land) ─────────────────────────

/** GET /api/v1/reports/definitions (pending backend). */
function fetchDefinitions(): Promise<ReportDefinition[]> {
  return resolveMock(mockReportDefinitions);
}
/** GET /api/v1/reports/jobs (pending backend). */
function fetchJobs(): Promise<ReportJob[]> {
  return resolveMock(mockReportJobs);
}
/** GET /api/v1/analytics/kpis (pending backend). */
function fetchKpis(): Promise<Kpi[]> {
  return resolveMock(mockKpis);
}
/** GET /api/v1/analytics/charts (pending backend). */
function fetchCharts(): Promise<MetricSeries[]> {
  return resolveMock(mockChartSeries);
}
/** GET /api/v1/analytics/dashboards (pending backend). */
function fetchDashboards(): Promise<Dashboard[]> {
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
 * Simulates the async job lifecycle (pending → running → succeeded) and pushes
 * the job into the jobs cache so the Jobs table reflects it. When the backend
 * lands, replace with `apiPost` + polling the returned job URL.
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
 * Mock: builds a small CSV blob and triggers a download.
 */
export function useExportRaw() {
  return useMutation<Blob, Error, { name: string }>({
    mutationFn: async () => {
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
