/**
 * Report schedules API — fixed-report cadence jobs (Phase 1 / F-05).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { downloadBlob } from '@/lib/video-stream';
import {
  apiDeleteNoContent,
  apiGetBlob,
  apiGetRaw,
  apiPatchRaw,
  apiPostRaw,
} from './client';

export type SchedulableReportType = 'trips' | 'vehicle-utilization' | 'alarms';
export type ScheduleCadence = 'daily' | 'weekly';
export type SchedulePreset = 'today' | 'yesterday' | '7d' | '30d';

export interface ReportScheduleWire {
  id: string;
  name: string;
  reportType: SchedulableReportType;
  cadence: ScheduleCadence;
  preset: SchedulePreset;
  enabled: boolean;
  nextRunAt: string;
  lastRunAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReportJobWire {
  id: string;
  scheduleId: string | null;
  reportType: SchedulableReportType;
  status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  filename: string | null;
  rowCount: number | null;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  downloadable: boolean;
}

export interface CreateReportSchedulePayload {
  name: string;
  reportType: SchedulableReportType;
  cadence: ScheduleCadence;
  preset?: SchedulePreset;
  enabled?: boolean;
}

export interface UpdateReportSchedulePayload {
  name?: string;
  cadence?: ScheduleCadence;
  preset?: SchedulePreset;
  enabled?: boolean;
}

export function useReportSchedules(enabled = true) {
  return useQuery({
    queryKey: ['reports', 'schedules'],
    queryFn: () => apiGetRaw<{ items: ReportScheduleWire[] }>('/reports/schedules'),
    enabled,
  });
}

export function useReportScheduleJobs(scheduleId: string | null) {
  return useQuery({
    queryKey: ['reports', 'schedules', scheduleId, 'jobs'],
    queryFn: () =>
      apiGetRaw<{ items: ReportJobWire[] }>(`/reports/schedules/${scheduleId}/jobs`),
    enabled: Boolean(scheduleId),
  });
}

export function useCreateReportSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateReportSchedulePayload) =>
      apiPostRaw<ReportScheduleWire>('/reports/schedules', payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['reports', 'schedules'] });
    },
  });
}

export function useUpdateReportSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: UpdateReportSchedulePayload }) =>
      apiPatchRaw<ReportScheduleWire>(`/reports/schedules/${id}`, payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['reports', 'schedules'] });
    },
  });
}

export function useDeleteReportSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiDeleteNoContent(`/reports/schedules/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['reports', 'schedules'] });
    },
  });
}

export function useRunReportSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiPostRaw<ReportJobWire>(`/reports/schedules/${id}/run`),
    onSuccess: (_job, id) => {
      void qc.invalidateQueries({ queryKey: ['reports', 'schedules'] });
      void qc.invalidateQueries({ queryKey: ['reports', 'schedules', id, 'jobs'] });
    },
  });
}

export async function downloadReportJob(jobId: string, filename?: string | null): Promise<void> {
  const blob = await apiGetBlob(`/reports/jobs/${jobId}/download`);
  downloadBlob(blob, filename ?? `report-job-${jobId}.csv`);
}
