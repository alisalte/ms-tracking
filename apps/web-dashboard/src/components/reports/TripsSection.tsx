/**
 * TripsSection — the TailAdmin trip report table (Sprint J §9, Phase 8
 * port): real backend rows, View-on-Map deep link into the existing history
 * map (§38), CSV export (§31 — backend blob, gated on report.export).
 * Vehicle filter; bounded pages (cursor).
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { getApiErrorMessage } from '@/api/errors';
import { type ReportRange, exportReportCsv, useTrips } from '@/api/report.api';
import { PERMISSIONS, PermissionGate } from '@/auth/permissions';
import { ErrorState } from '@/components/common/ErrorState';
import { useToast } from '@/components/feedback/ToastProvider';
import { type Column, ReportsTable } from '@/components/reports/ReportsTable';
import { Button } from '@/components/tailwind-ui';
import { Download, Map as MapIcon } from 'lucide-react';

export function TripsSection({ range }: { range: ReportRange }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [vehicleId, setVehicleId] = useState('');
  const [exporting, setExporting] = useState(false);
  const q = useTrips(range, vehicleId ? { vehicleId } : {});

  const columns: Column<NonNullable<typeof q.data>['items'][number]>[] = [
    { id: 'label', headerKey: 'reports.cols.vehicle', render: (r) => r.label },
    {
      id: 'start',
      headerKey: 'reports.cols.start',
      render: (r) => new Date(r.startedAt).toLocaleString(),
    },
    {
      id: 'end',
      headerKey: 'reports.cols.end',
      render: (r) => (r.endedAt ? new Date(r.endedAt).toLocaleString() : '—'),
    },
    { id: 'duration', headerKey: 'reports.cols.duration', render: (r) => fmtDur(r.durationSec) },
    {
      id: 'distance',
      headerKey: 'reports.cols.distance',
      render: (r) => `${r.distanceKm.toFixed(1)} km`,
    },
    {
      id: 'avg',
      headerKey: 'reports.cols.avgSpeed',
      render: (r) => (r.avgSpeedKph === null ? '—' : `${r.avgSpeedKph.toFixed(1)} km/h`),
    },
    {
      id: 'max',
      headerKey: 'reports.cols.maxSpeed',
      render: (r) => `${r.maxSpeedKph.toFixed(0)} km/h`,
    },
    { id: 'idle', headerKey: 'reports.cols.idle', render: (r) => fmtDur(r.idleSec) },
    { id: 'parking', headerKey: 'reports.cols.parking', render: (r) => fmtDur(r.parkingSec) },
    {
      id: 'actions',
      header: '',
      render: (r) => (
        <a
          href={`/map?vehicle=${encodeURIComponent(r.vehicleId)}&from=${encodeURIComponent(
            r.startedAt,
          )}&to=${encodeURIComponent(r.endedAt ?? new Date().toISOString())}`}
          data-testid="report-trip-view-map"
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-gray-300 px-2.5 text-xs font-medium text-gray-700 no-underline transition-colors hover:bg-gray-50 dark:border-white/10 dark:text-graydark-700 dark:hover:bg-white/5"
        >
          <MapIcon size={13} aria-hidden />
          {t('reports.viewOnMap')}
        </a>
      ),
    },
  ];

  const doExport = async () => {
    setExporting(true);
    try {
      await exportReportCsv('trips', range, vehicleId ? { vehicleId } : {});
      toast.success(t('reports.export.done'));
    } catch (err) {
      toast.error(getApiErrorMessage(err) ?? t('errors.generic'));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <select
          value={vehicleId}
          onChange={(e) => setVehicleId(e.target.value)}
          aria-label={t('reports.filters.vehicleId')}
          className="h-9 min-w-65 cursor-pointer rounded-lg border border-gray-300 bg-white px-2.5 text-sm text-gray-700 focus:border-brand-500 focus:outline-none dark:border-white/10 dark:bg-graydark-300 dark:text-graydark-800"
        >
          <option value="">{t('reports.filters.allVehicles')}</option>
          {[...new Map((q.data?.items ?? []).map((r) => [r.vehicleId, r.label])).entries()].map(
            ([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ),
          )}
        </select>
        <PermissionGate requires={PERMISSIONS.reportExport}>
          <Button
            size="sm"
            variant="outline"
            leftIcon={<Download size={14} />}
            onClick={doExport}
            disabled={exporting || q.isLoading}
            data-testid="report-export-trips"
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
          rowKey={(r) => r.id}
          emptyKey="reports.empty"
          dense
        />
      )}
    </div>
  );
}

function fmtDur(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
