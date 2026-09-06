/**
 * GeofencesSection — ENTER/EXIT/DWELL aggregates with KPIs and a chart.
 */
import type { ApexOptions } from 'apexcharts';
import { Fence, LogIn, LogOut, Timer } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { type GeofenceReportRowWire, type ReportRange, useGeofenceReport } from '@/api/report.api';
import { ErrorState } from '@/components/common/ErrorState';
import { ApexChart } from '@/components/dashboard/ApexChart';
import { KpiTile } from '@/components/dashboard/KpiTile';
import { type Column, ReportsTable } from '@/components/reports/ReportsTable';
import { Card, CardHeader } from '@/components/tailwind-ui';
import { formatDurationSec, hours1, shortLabel } from '@/lib/report-format';
import { chart } from '@/theme/palette';

export function GeofencesSection({ range }: { range: ReportRange }) {
  const { t } = useTranslation();
  const q = useGeofenceReport(range);
  const rows = q.data?.items ?? [];

  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, r) => {
          acc.enters += r.enters;
          acc.exits += r.exits;
          acc.dwells += r.dwells;
          acc.inside += r.timeInsideSec;
          return acc;
        },
        { enters: 0, exits: 0, dwells: 0, inside: 0 },
      ),
    [rows],
  );

  const byFence = useMemo(() => {
    const map = new Map<string, { label: string; events: number }>();
    for (const r of rows) {
      const key = r.geofenceId ?? r.geofenceName ?? '—';
      const prev = map.get(key) ?? { label: r.geofenceName ?? r.geofenceId ?? '—', events: 0 };
      prev.events += r.enters + r.exits + r.dwells;
      map.set(key, prev);
    }
    return [...map.values()].sort((a, b) => b.events - a.events).slice(0, 10);
  }, [rows]);

  const barOptions = useMemo<ApexOptions>(
    () => ({
      colors: [chart.geofence],
      plotOptions: { bar: { horizontal: true, barHeight: '68%', borderRadius: 6 } },
      xaxis: { categories: byFence.map((r) => shortLabel(r.label)) },
    }),
    [byFence],
  );
  const barSeries = useMemo(
    () => [{ name: t('reports.kpi.geofenceEvents'), data: byFence.map((r) => r.events) }],
    [byFence, t],
  );

  const columns: Column<GeofenceReportRowWire>[] = [
    {
      id: 'fence',
      headerKey: 'reports.cols.geofence',
      render: (r) => r.geofenceName ?? r.geofenceId ?? '—',
    },
    { id: 'vehicle', headerKey: 'reports.cols.vehicle', render: (r) => r.label ?? '—' },
    { id: 'enters', headerKey: 'reports.cols.enters', render: (r) => String(r.enters) },
    { id: 'exits', headerKey: 'reports.cols.exits', render: (r) => String(r.exits) },
    { id: 'dwells', headerKey: 'reports.cols.dwells', render: (r) => String(r.dwells) },
    {
      id: 'inside',
      headerKey: 'reports.cols.timeInside',
      render: (r) => formatDurationSec(r.timeInsideSec),
    },
  ];

  return (
    <div className="flex flex-col gap-4" data-testid="report-geofences">
      {q.isLoading ? (
        <div className="py-2 text-sm text-gray-500 dark:text-graydark-600">
          {t('common.loading')}
        </div>
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <KpiTile
              labelKey="reports.cols.enters"
              value={totals.enters}
              icon={LogIn}
              tone="info"
            />
            <KpiTile
              labelKey="reports.cols.exits"
              value={totals.exits}
              icon={LogOut}
              tone="brand"
            />
            <KpiTile
              labelKey="reports.cols.dwells"
              value={totals.dwells}
              icon={Fence}
              tone="warning"
            />
            <KpiTile
              labelKey="reports.cols.timeInside"
              value={hours1(totals.inside)}
              suffix="h"
              icon={Timer}
              tone="teal"
            />
          </div>
          <Card>
            <CardHeader title={t('reports.charts.geofenceEvents')} />
            {byFence.length === 0 ? (
              <EmptyChart label={t('reports.charts.empty')} />
            ) : (
              <ApexChart type="bar" series={barSeries} options={barOptions} height={260} />
            )}
          </Card>
          <ReportsTable
            columns={columns}
            rows={rows}
            rowKey={(r) => `${r.geofenceId ?? 'g'}-${r.vehicleId ?? 'v'}`}
            emptyKey="reports.empty"
            dense
          />
          <p className="text-xs text-gray-500 dark:text-graydark-600">
            {t('reports.geofence.note')}
          </p>
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
