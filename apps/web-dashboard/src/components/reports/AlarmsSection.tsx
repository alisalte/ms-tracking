/**
 * AlarmsSection — the TailAdmin alarm report (Sprint J §12/§13, Phase 8
 * port): summary chips by severity/status, severity filter, per-vehicle/type
 * breakdown table with a View Alarm link into the existing alarms page (§39),
 * CSV export (backend blob, gated on report.export). Alarm counts come from
 * the alarm engine's records only (§63).
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { getApiErrorMessage } from '@/api/errors';
import { type ReportRange, exportReportCsv, useAlarmReport } from '@/api/report.api';
import { PERMISSIONS, PermissionGate } from '@/auth/permissions';
import { ErrorState } from '@/components/common/ErrorState';
import { useToast } from '@/components/feedback/ToastProvider';
import { type Column, ReportsTable } from '@/components/reports/ReportsTable';
import { Badge, Button } from '@/components/tailwind-ui';
import { Bell, Download } from 'lucide-react';

const SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];

export function AlarmsSection({ range }: { range: ReportRange }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [severity, setSeverity] = useState('');
  const [exporting, setExporting] = useState(false);
  const q = useAlarmReport(range, severity ? { severity } : {});

  const columns: Column<NonNullable<typeof q.data>['items'][number]>[] = [
    { id: 'label', headerKey: 'reports.cols.vehicle', render: (r) => r.label ?? '—' },
    { id: 'type', headerKey: 'reports.cols.alarmType', render: (r) => r.type },
    {
      id: 'severity',
      headerKey: 'reports.cols.severity',
      render: (r) => (
        <Badge
          color={
            r.severity === 'CRITICAL' || r.severity === 'HIGH'
              ? 'danger'
              : r.severity === 'MEDIUM'
                ? 'warning'
                : 'gray'
          }
        >
          {r.severity}
        </Badge>
      ),
    },
    { id: 'total', headerKey: 'reports.cols.total', render: (r) => String(r.total) },
    { id: 'open', headerKey: 'reports.cols.open', render: (r) => String(r.open) },
    { id: 'ack', headerKey: 'reports.cols.acknowledged', render: (r) => String(r.acknowledged) },
    { id: 'resolved', headerKey: 'reports.cols.resolved', render: (r) => String(r.resolved) },
    {
      id: 'actions',
      header: '',
      render: () => (
        <a
          href="/alarms"
          data-testid="report-alarm-view"
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-gray-300 px-2.5 text-xs font-medium text-gray-700 no-underline transition-colors hover:bg-gray-50 dark:border-white/10 dark:text-graydark-700 dark:hover:bg-white/5"
        >
          <Bell size={13} aria-hidden />
          {t('reports.viewAlarm')}
        </a>
      ),
    },
  ];

  const doExport = async () => {
    setExporting(true);
    try {
      await exportReportCsv('alarms', range, severity ? { severity } : {});
      toast.success(t('reports.export.done'));
    } catch (err) {
      toast.error(getApiErrorMessage(err) ?? t('errors.generic'));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      {/* Summary chips */}
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge color="gray">{`${t('reports.kpi.alarms')}: ${q.data?.summary.total ?? 0}`}</Badge>
        <Badge color="danger">{`${t('reports.kpi.open')}: ${q.data?.summary.open ?? 0}`}</Badge>
        {SEVERITIES.map((s) => (
          <Badge key={s} color="gray">
            {`${s}: ${(q.data?.summary as unknown as Record<string, number>)?.[s.toLowerCase()] ?? 0}`}
          </Badge>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <select
          value={severity}
          onChange={(e) => setSeverity(e.target.value)}
          aria-label={t('reports.filters.severity')}
          data-testid="report-severity-filter"
          className="h-9 min-w-40 cursor-pointer rounded-lg border border-gray-300 bg-white px-2.5 text-sm text-gray-700 focus:border-brand-500 focus:outline-none dark:border-white/10 dark:bg-graydark-300 dark:text-graydark-800"
        >
          <option value="">{t('reports.filters.allSeverities')}</option>
          {SEVERITIES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <PermissionGate requires={PERMISSIONS.reportExport}>
          <Button
            size="sm"
            variant="outline"
            leftIcon={<Download size={14} />}
            onClick={doExport}
            disabled={exporting || q.isLoading}
            data-testid="report-export-alarms"
          >
            {exporting ? t('reports.export.exporting') : t('reports.export.csv')}
          </Button>
        </PermissionGate>
      </div>
      {q.isLoading ? (
        <div className="py-2 text-sm text-gray-500 dark:text-graydark-600">
          {t('common.loading')}
        </div>
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <ReportsTable
          columns={columns}
          rows={q.data?.items ?? []}
          rowKey={(r) => `${r.vehicleId ?? 'none'}-${r.type}-${r.severity}`}
          emptyKey="reports.empty"
          dense
        />
      )}
    </div>
  );
}
