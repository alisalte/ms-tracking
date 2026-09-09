/**
 * SchedulesSection — create / toggle / run / download fixed report schedules.
 */
import { Download, Play, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { getApiErrorMessage } from '@/api/errors';
import {
  type CreateReportSchedulePayload,
  type ReportScheduleWire,
  type SchedulableReportType,
  downloadReportJob,
  useCreateReportSchedule,
  useDeleteReportSchedule,
  useReportScheduleJobs,
  useReportSchedules,
  useRunReportSchedule,
  useUpdateReportSchedule,
} from '@/api/report-schedule.api';
import { PERMISSIONS, PermissionGate } from '@/auth/permissions';
import { ErrorState } from '@/components/common/ErrorState';
import { useToast } from '@/components/feedback/ToastProvider';
import { type Column, ReportsTable } from '@/components/reports/ReportsTable';
import { Badge, Button, Input, Select } from '@/components/tailwind-ui';
import { formatDateTime } from '@/lib/format-date';

const REPORT_TYPES: SchedulableReportType[] = ['trips', 'vehicle-utilization', 'alarms'];

export function SchedulesSection() {
  return (
    <PermissionGate requires={PERMISSIONS.reportSchedule} fallback={<SchedulesDenied />}>
      <SchedulesPanel />
    </PermissionGate>
  );
}

function SchedulesDenied() {
  const { t } = useTranslation();
  return (
    <p
      className="text-sm text-gray-500 dark:text-graydark-600"
      data-testid="report-schedules-denied"
    >
      {t('reports.schedules.denied')}
    </p>
  );
}

function SchedulesPanel() {
  const { t } = useTranslation();
  const toast = useToast();
  const list = useReportSchedules();
  const create = useCreateReportSchedule();
  const update = useUpdateReportSchedule();
  const remove = useDeleteReportSchedule();
  const run = useRunReportSchedule();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const jobs = useReportScheduleJobs(selectedId);

  const [form, setForm] = useState<CreateReportSchedulePayload>({
    name: '',
    reportType: 'trips',
    cadence: 'daily',
    preset: '7d',
  });

  const onCreate = async () => {
    try {
      const created = await create.mutateAsync(form);
      setForm({ name: '', reportType: 'trips', cadence: 'daily', preset: '7d' });
      setSelectedId(created.id);
      toast.success(t('reports.schedules.created'));
    } catch (err) {
      toast.error(getApiErrorMessage(err) || t('reports.schedules.createFailed'));
    }
  };

  const onToggle = async (row: ReportScheduleWire) => {
    try {
      await update.mutateAsync({ id: row.id, payload: { enabled: !row.enabled } });
    } catch (err) {
      toast.error(getApiErrorMessage(err) || t('reports.schedules.updateFailed'));
    }
  };

  const onRun = async (id: string) => {
    try {
      await run.mutateAsync(id);
      setSelectedId(id);
      toast.success(t('reports.schedules.runStarted'));
    } catch (err) {
      toast.error(getApiErrorMessage(err) || t('reports.schedules.runFailed'));
    }
  };

  const onDelete = async (id: string) => {
    try {
      await remove.mutateAsync(id);
      if (selectedId === id) setSelectedId(null);
      toast.success(t('reports.schedules.deleted'));
    } catch (err) {
      toast.error(getApiErrorMessage(err) || t('reports.schedules.deleteFailed'));
    }
  };

  const columns: Column<ReportScheduleWire>[] = [
    {
      id: 'name',
      header: t('reports.schedules.colName'),
      render: (r) => (
        <button
          type="button"
          className="cursor-pointer border-none bg-transparent p-0 text-start font-semibold text-brand-600 hover:underline dark:text-brand-300"
          onClick={() => setSelectedId(r.id)}
        >
          {r.name}
        </button>
      ),
    },
    {
      id: 'reportType',
      header: t('reports.schedules.colReport'),
      render: (r) => t(`reports.schedules.reportTypes.${r.reportType}`),
    },
    {
      id: 'cadence',
      header: t('reports.schedules.colCadence'),
      render: (r) => t(`reports.schedules.cadences.${r.cadence}`),
    },
    {
      id: 'preset',
      header: t('reports.schedules.colPreset'),
      render: (r) => t(`reports.range.${r.preset}`),
    },
    {
      id: 'enabled',
      header: t('reports.schedules.colStatus'),
      render: (r) => (
        <Badge color={r.enabled ? 'success' : 'gray'}>
          {r.enabled ? t('reports.schedules.enabled') : t('reports.schedules.disabled')}
        </Badge>
      ),
    },
    {
      id: 'nextRunAt',
      header: t('reports.schedules.colNext'),
      render: (r) => formatDateTime(r.nextRunAt),
    },
    {
      id: 'actions',
      header: t('reports.schedules.colActions'),
      render: (r) => (
        <div className="flex flex-wrap gap-1">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void onRun(r.id)}
            disabled={run.isPending}
            data-testid={`report-schedule-run-${r.id}`}
          >
            <Play size={14} aria-hidden />
            {t('reports.schedules.runNow')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void onToggle(r)}>
            {r.enabled ? t('reports.schedules.disable') : t('reports.schedules.enable')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void onDelete(r.id)}
            data-testid={`report-schedule-delete-${r.id}`}
          >
            <Trash2 size={14} aria-hidden />
          </Button>
        </div>
      ),
    },
  ];

  if (list.isError) {
    return <ErrorState error={list.error} onRetry={() => void list.refetch()} />;
  }

  return (
    <div className="flex flex-col gap-4" data-testid="report-schedules">
      <p className="text-sm text-gray-500 dark:text-graydark-600">{t('reports.schedules.note')}</p>

      <div className="grid grid-cols-1 gap-3 rounded-2xl border border-gray-200 bg-white p-4 dark:border-white/10 dark:bg-graydark-300 md:grid-cols-5">
        <Input
          label={t('reports.schedules.colName')}
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          data-testid="report-schedule-name"
        />
        <Select
          label={t('reports.schedules.colReport')}
          value={form.reportType}
          onChange={(e) =>
            setForm((f) => ({ ...f, reportType: e.target.value as SchedulableReportType }))
          }
          options={REPORT_TYPES.map((rt) => ({
            value: rt,
            label: t(`reports.schedules.reportTypes.${rt}`),
          }))}
        />
        <Select
          label={t('reports.schedules.colCadence')}
          value={form.cadence}
          onChange={(e) =>
            setForm((f) => ({ ...f, cadence: e.target.value as 'daily' | 'weekly' }))
          }
          options={[
            { value: 'daily', label: t('reports.schedules.cadences.daily') },
            { value: 'weekly', label: t('reports.schedules.cadences.weekly') },
          ]}
        />
        <Select
          label={t('reports.schedules.colPreset')}
          value={form.preset ?? '7d'}
          onChange={(e) =>
            setForm((f) => ({
              ...f,
              preset: e.target.value as CreateReportSchedulePayload['preset'],
            }))
          }
          options={(['today', 'yesterday', '7d', '30d'] as const).map((p) => ({
            value: p,
            label: t(`reports.range.${p}`),
          }))}
        />
        <div className="flex items-end">
          <Button
            onClick={() => void onCreate()}
            disabled={!form.name.trim() || create.isPending}
            data-testid="report-schedule-create"
          >
            <Plus size={16} aria-hidden />
            {t('reports.schedules.create')}
          </Button>
        </div>
      </div>

      {list.isLoading ? (
        <p className="text-sm text-gray-500">{t('common.loading')}</p>
      ) : (
        <ReportsTable
          columns={columns}
          rows={list.data?.items ?? []}
          rowKey={(r) => r.id}
          emptyKey="reports.schedules.empty"
        />
      )}

      {selectedId && (
        <div className="flex flex-col gap-2" data-testid="report-schedule-jobs">
          <h3 className="text-sm font-semibold text-gray-800 dark:text-white">
            {t('reports.schedules.jobsTitle')}
          </h3>
          {jobs.isLoading && <p className="text-sm text-gray-500">{t('common.loading')}</p>}
          {jobs.isError && (
            <ErrorState error={jobs.error} onRetry={() => void jobs.refetch()} />
          )}
          {(jobs.data?.items ?? []).length === 0 && !jobs.isLoading && (
            <p className="text-sm text-gray-500">{t('reports.schedules.jobsEmpty')}</p>
          )}
          <ul className="flex flex-col gap-2">
            {(jobs.data?.items ?? []).map((job) => (
              <li
                key={job.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-gray-200 px-3 py-2 text-sm dark:border-white/10"
              >
                <span>
                  <Badge
                    color={
                      job.status === 'SUCCEEDED'
                        ? 'success'
                        : job.status === 'FAILED'
                          ? 'danger'
                          : 'gray'
                    }
                  >
                    {job.status}
                  </Badge>{' '}
                  {job.finishedAt ? formatDateTime(job.finishedAt) : '—'}
                  {job.rowCount != null ? ` · ${job.rowCount} rows` : ''}
                  {job.error ? ` · ${job.error}` : ''}
                </span>
                {job.downloadable && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() =>
                      void downloadReportJob(job.id, job.filename).catch((err) =>
                        toast.error(
                          getApiErrorMessage(err) || t('reports.schedules.downloadFailed'),
                        ),
                      )
                    }
                  >
                    <Download size={14} aria-hidden />
                    {t('reports.schedules.download')}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
