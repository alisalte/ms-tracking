/**
 * GeofencesSection — ENTER/EXIT/DWELL aggregates with KPIs, filters, and dwell polish (F-04 v1).
 */
import type { ApexOptions } from 'apexcharts';
import { Bell, Fence, LogIn, LogOut, Map as MapIcon, Timer } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { useVehicles } from '@/api/asset.api';
import { useGeofences } from '@/api/geofence.api';
import { type GeofenceReportRowWire, type ReportRange, useGeofenceReport } from '@/api/report.api';
import { ErrorState } from '@/components/common/ErrorState';
import { ApexChart } from '@/components/dashboard/ApexChart';
import { KpiTile } from '@/components/dashboard/KpiTile';
import { type Column, ReportsTable } from '@/components/reports/ReportsTable';
import { Card, CardHeader, Checkbox } from '@/components/tailwind-ui';
import { formatDurationSec, hours1, shortLabel } from '@/lib/report-format';
import { chart } from '@/theme/palette';

export function GeofencesSection({ range }: { range: ReportRange }) {
  const { t } = useTranslation();
  const [vehicleId, setVehicleId] = useState('');
  const [geofenceId, setGeofenceId] = useState('');
  const [dwellOnly, setDwellOnly] = useState(false);

  const vehiclesQ = useVehicles();
  const geofencesQ = useGeofences();
  const filters = {
    ...(vehicleId ? { vehicleId } : {}),
    ...(geofenceId ? { geofenceId } : {}),
  };
  const q = useGeofenceReport(range, filters);
  const rawRows = q.data?.items ?? [];

  const rows = useMemo(() => {
    const list = dwellOnly ? rawRows.filter((r) => r.dwells > 0 || r.timeInsideSec > 0) : rawRows;
    return [...list].sort((a, b) => b.timeInsideSec - a.timeInsideSec);
  }, [rawRows, dwellOnly]);

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
    {
      id: 'avgDwell',
      headerKey: 'reports.cols.avgDwell',
      render: (r) => {
        if (r.exits <= 0) return '—';
        return formatDurationSec(Math.round(r.timeInsideSec / r.exits));
      },
    },
    {
      id: 'actions',
      header: '',
      render: (r) => (
        <div className="flex flex-wrap items-center gap-1.5">
          {r.vehicleId && (
            <Link
              to={`/map?vehicle=${encodeURIComponent(r.vehicleId)}`}
              className="inline-flex h-8 items-center gap-1 rounded-lg border border-gray-300 px-2 text-xs font-medium text-gray-700 no-underline hover:bg-gray-50 dark:border-white/10 dark:text-graydark-700 dark:hover:bg-white/5"
            >
              <MapIcon size={13} aria-hidden />
              {t('reports.viewOnMap')}
            </Link>
          )}
          <Link
            to={`/alarms?type=geofence${r.geofenceName ? `&q=${encodeURIComponent(r.geofenceName)}` : ''}`}
            className="inline-flex h-8 items-center gap-1 rounded-lg border border-gray-300 px-2 text-xs font-medium text-gray-700 no-underline hover:bg-gray-50 dark:border-white/10 dark:text-graydark-700 dark:hover:bg-white/5"
          >
            <Bell size={13} aria-hidden />
            {t('reports.geofence.viewAlarms')}
          </Link>
        </div>
      ),
    },
  ];

  const vehicleOptions = vehiclesQ.data ?? [];
  const geofenceOptions = geofencesQ.data ?? [];

  return (
    <div className="flex flex-col gap-4" data-testid="report-geofences">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={vehicleId}
          onChange={(e) => setVehicleId(e.target.value)}
          aria-label={t('reports.filters.vehicleId')}
          className="h-9 min-w-48 cursor-pointer rounded-lg border border-gray-300 bg-white px-2.5 text-sm text-gray-700 focus:border-brand-500 focus:outline-none dark:border-white/10 dark:bg-graydark-300 dark:text-graydark-800"
        >
          <option value="">{t('reports.filters.allVehicles')}</option>
          {vehicleOptions.map((v) => (
            <option key={v.id} value={v.id}>
              {v.plate ? `${v.name} · ${v.plate}` : v.name}
            </option>
          ))}
        </select>
        <select
          value={geofenceId}
          onChange={(e) => setGeofenceId(e.target.value)}
          aria-label={t('reports.filters.geofenceId')}
          className="h-9 min-w-48 cursor-pointer rounded-lg border border-gray-300 bg-white px-2.5 text-sm text-gray-700 focus:border-brand-500 focus:outline-none dark:border-white/10 dark:bg-graydark-300 dark:text-graydark-800"
        >
          <option value="">{t('reports.filters.allGeofences')}</option>
          {geofenceOptions.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
        <Checkbox
          label={t('reports.geofence.dwellOnly')}
          checked={dwellOnly}
          onChange={(e) => setDwellOnly(e.target.checked)}
        />
      </div>

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
