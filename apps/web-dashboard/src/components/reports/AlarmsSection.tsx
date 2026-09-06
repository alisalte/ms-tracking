/**
 * AlarmsSection — summary chips, severity/type charts, breakdown table, CSV.
 */
import type { ApexOptions } from 'apexcharts';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { getApiErrorMessage } from '@/api/errors';
import { type ReportRange, exportReportCsv, useAlarmReport } from '@/api/report.api';
import { PERMISSIONS, PermissionGate } from '@/auth/permissions';
import { ErrorState } from '@/components/common/ErrorState';
import { ApexChart } from '@/components/dashboard/ApexChart';
import { useToast } from '@/components/feedback/ToastProvider';
import { type Column, ReportsTable } from '@/components/reports/ReportsTable';
import { Badge, Button, Card, CardHeader } from '@/components/tailwind-ui';
import { localizeEventType } from '@/lib/alarm-copy';
import { shortLabel } from '@/lib/report-format';
import { chart } from '@/theme/palette';
import { Bell, Download } from 'lucide-react';

const SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'] as const;

export function AlarmsSection({ range }: { range: ReportRange }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [severity, setSeverity] = useState('');
  const [exporting, setExporting] = useState(false);
  const q = useAlarmReport(range, severity ? { severity } : {});
  const summary = q.data?.summary;
  const items = q.data?.items ?? [];

  const severityMix = useMemo(() => {
    if (!summary) return [];
    return [
      { label: t('rules.severities.CRITICAL'), value: summary.critical, color: chart.critical },
      { label: t('rules.severities.HIGH'), value: summary.high, color: chart.high },
      { label: t('rules.severities.MEDIUM'), value: summary.medium, color: chart.medium },
      { label: t('rules.severities.LOW'), value: summary.low, color: chart.low },
      { label: t('rules.severities.INFO'), value: summary.info, color: chart.info },
    ].filter((s) => s.value > 0);
  }, [summary, t]);

  const typeRows = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of items) {
      map.set(r.type, (map.get(r.type) ?? 0) + r.total);
    }
    return [...map.entries()]
      .map(([type, total]) => ({ type, total, label: localizeEventType(t, type) }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);
  }, [items, t]);

  const donutOptions = useMemo<ApexOptions>(
    () => ({
      labels: severityMix.map((s) => s.label),
      colors: severityMix.map((s) => s.color),
      legend: { position: 'bottom' },
      plotOptions: {
        pie: {
          donut: {
            size: '68%',
            labels: { show: true, total: { show: true, label: t('reports.kpi.alarms') } },
          },
        },
      },
    }),
    [severityMix, t],
  );

  const typeOptions = useMemo<ApexOptions>(
    () => ({
      colors: [chart.speeding],
      plotOptions: { bar: { horizontal: true, barHeight: '68%', borderRadius: 6 } },
      xaxis: { categories: typeRows.map((r) => shortLabel(r.label)) },
    }),
    [typeRows],
  );
  const typeSeries = useMemo(
    () => [{ name: t('reports.cols.total'), data: typeRows.map((r) => r.total) }],
    [typeRows, t],
  );

  const columns: Column<NonNullable<typeof q.data>['items'][number]>[] = [
    { id: 'label', headerKey: 'reports.cols.vehicle', render: (r) => r.label ?? '—' },
    {
      id: 'type',
      headerKey: 'reports.cols.alarmType',
      render: (r) => localizeEventType(t, r.type),
    },
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
          {t(`rules.severities.${r.severity}`, { defaultValue: r.severity })}
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
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge color="gray">{`${t('reports.kpi.alarms')}: ${summary?.total ?? 0}`}</Badge>
        <Badge color="danger">{`${t('reports.kpi.open')}: ${summary?.open ?? 0}`}</Badge>
        {SEVERITIES.map((s) => (
          <Badge key={s} color="gray">
            {`${t(`rules.severities.${s}`, { defaultValue: s })}: ${(summary as unknown as Record<string, number> | undefined)?.[s.toLowerCase()] ?? 0}`}
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
              {t(`rules.severities.${s}`, { defaultValue: s })}
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
        <>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <Card>
              <CardHeader title={t('reports.charts.alarmSeverity')} />
              {severityMix.length === 0 ? (
                <EmptyChart label={t('reports.charts.empty')} />
              ) : (
                <ApexChart
                  type="donut"
                  series={severityMix.map((s) => s.value)}
                  options={donutOptions}
                  height={260}
                />
              )}
            </Card>
            <Card>
              <CardHeader title={t('reports.charts.alarmByType')} />
              {typeRows.length === 0 ? (
                <EmptyChart label={t('reports.charts.empty')} />
              ) : (
                <ApexChart type="bar" series={typeSeries} options={typeOptions} height={260} />
              )}
            </Card>
          </div>
          <ReportsTable
            columns={columns}
            rows={items}
            rowKey={(r) => `${r.vehicleId ?? 'none'}-${r.type}-${r.severity}`}
            emptyKey="reports.empty"
            dense
          />
        </>
      )}
    </div>
  );
}

function EmptyChart({ label }: { label: string }) {
  return (
    <div className="flex h-[220px] items-center justify-center">
      <p className="text-sm text-gray-500 dark:text-graydark-600">{label}</p>
    </div>
  );
}
