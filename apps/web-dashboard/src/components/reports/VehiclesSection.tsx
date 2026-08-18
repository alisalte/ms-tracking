/**
 * VehiclesSection — TailAdmin utilization / distance / speed / idle-parking
 * tables (Sprint J §7/§8/§10/§11, Phase 8 port) + the vehicle report detail
 * modal (§37) + CSV export for utilization. All numbers are backend KPIs;
 * null utilization renders "—" with the no-data note (never a fake zero).
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink } from 'react-router';

import { getApiErrorMessage } from '@/api/errors';
import {
  type ReportRange,
  type UtilizationRowWire,
  exportReportCsv,
  useDistance,
  useIdleParking,
  useSpeed,
  useUtilization,
} from '@/api/report.api';
import { PERMISSIONS, PermissionGate } from '@/auth/permissions';
import { ErrorState } from '@/components/common/ErrorState';
import { useToast } from '@/components/feedback/ToastProvider';
import { type Column, ReportsTable } from '@/components/reports/ReportsTable';
import { Badge, Button, Modal } from '@/components/tailwind-ui';
import { Download, Map as MapIcon } from 'lucide-react';

function fmtSec(s: number | null): string {
  if (s === null) return '—';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function LoadingLine() {
  return <div className="py-2 text-sm text-gray-500 dark:text-graydark-600">Loading…</div>;
}

export function VehiclesSection({ range }: { range: ReportRange }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState(0);
  const tabs: Array<{ id: string; label: string; testid?: string }> = [
    {
      id: 'utilization',
      label: t('reports.vehicles.utilization'),
      testid: 'report-tab-utilization',
    },
    { id: 'distance', label: t('reports.distance.title') },
    { id: 'speed', label: t('reports.speed.title') },
    { id: 'idle-parking', label: t('reports.idleParking.title') },
  ];
  return (
    <div className="flex flex-col gap-3">
      <div
        role="tablist"
        aria-label={t('reports.vehicles.tabs')}
        className="flex w-fit items-center gap-1 rounded-xl bg-gray-100 p-1 dark:bg-white/5"
      >
        {tabs.map((tb, i) => (
          <button
            key={tb.id}
            type="button"
            role="tab"
            aria-selected={tab === i}
            data-testid={tb.testid}
            onClick={() => setTab(i)}
            className={`cursor-pointer rounded-lg border-none px-3 py-1.5 text-sm font-semibold transition-colors ${
              tab === i
                ? 'bg-white text-gray-900 shadow-sm dark:bg-graydark-300 dark:text-white'
                : 'bg-transparent text-gray-500 hover:text-gray-800 dark:text-graydark-600 dark:hover:text-white'
            }`}
          >
            {tb.label}
          </button>
        ))}
      </div>
      {tab === 0 && <UtilizationTable range={range} />}
      {tab === 1 && <DistanceTable range={range} />}
      {tab === 2 && <SpeedTable range={range} />}
      {tab === 3 && <IdleParkingTable range={range} />}
    </div>
  );
}

function UtilizationTable({ range }: { range: ReportRange }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [detail, setDetail] = useState<UtilizationRowWire | null>(null);
  const [exporting, setExporting] = useState(false);
  const q = useUtilization(range);

  const columns: Column<UtilizationRowWire>[] = [
    { id: 'label', headerKey: 'reports.cols.vehicle', render: (r) => r.label },
    { id: 'moving', headerKey: 'reports.cols.moving', render: (r) => fmtSec(r.movingSec) },
    { id: 'idle', headerKey: 'reports.cols.idle', render: (r) => fmtSec(r.idleSec) },
    { id: 'parking', headerKey: 'reports.cols.parking', render: (r) => fmtSec(r.parkingSec) },
    { id: 'observed', headerKey: 'reports.cols.observed', render: (r) => fmtSec(r.observedSec) },
    {
      id: 'utilization',
      headerKey: 'reports.cols.utilization',
      render: (r) => (r.utilizationPct === null ? '—' : `${r.utilizationPct.toFixed(1)}%`),
    },
    {
      id: 'distance',
      headerKey: 'reports.cols.distance',
      render: (r) => `${r.distanceKm.toFixed(1)} km`,
    },
    { id: 'trips', headerKey: 'reports.cols.trips', render: (r) => String(r.trips) },
  ];

  const doExport = async () => {
    setExporting(true);
    try {
      await exportReportCsv('vehicle-utilization', range);
      toast.success(t('reports.export.done'));
    } catch (err) {
      toast.error(getApiErrorMessage(err) ?? t('errors.generic'));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex justify-end">
        {/* Export uses the backend CSV endpoint — gated on report.export. */}
        <PermissionGate requires={PERMISSIONS.reportExport}>
          <Button
            size="sm"
            variant="outline"
            leftIcon={<Download size={14} />}
            onClick={doExport}
            disabled={exporting || q.isLoading}
            data-testid="report-export-utilization"
          >
            {exporting ? t('reports.export.exporting') : t('reports.export.csv')}
          </Button>
        </PermissionGate>
      </div>
      {q.isLoading ? (
        <LoadingLine />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <>
          <ReportsTable
            columns={columns}
            rows={q.data?.items ?? []}
            rowKey={(r) => r.vehicleId}
            onRowClick={(r) => setDetail(r)}
            emptyKey="reports.empty"
            dense
          />
          <p className="text-xs text-gray-500 dark:text-graydark-600">
            {t('reports.utilization.note')}
          </p>
        </>
      )}
      <VehicleDetailModal row={detail} onClose={() => setDetail(null)} />
    </div>
  );
}

function VehicleDetailModal({
  row,
  onClose,
}: {
  row: UtilizationRowWire | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  if (!row) return null;
  return (
    <Modal open onClose={onClose} size="sm" title={row.label}>
      <div className="flex flex-col gap-2">
        <Row label={t('reports.cols.moving')} value={fmtSec(row.movingSec)} />
        <Row label={t('reports.cols.idle')} value={fmtSec(row.idleSec)} />
        <Row label={t('reports.cols.parking')} value={fmtSec(row.parkingSec)} />
        <Row label={t('reports.cols.observed')} value={fmtSec(row.observedSec)} />
        <Row
          label={t('reports.cols.utilization')}
          value={
            row.utilizationPct === null
              ? `— (${t('reports.noData')})`
              : `${row.utilizationPct.toFixed(1)}%`
          }
        />
        <Row label={t('reports.cols.distance')} value={`${row.distanceKm.toFixed(1)} km`} />
        <Row label={t('reports.cols.trips')} value={String(row.trips)} />
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <RouterLink
          to={`/map?vehicle=${encodeURIComponent(row.vehicleId)}&from=${encodeURIComponent(
            new Date(Date.now() - 7 * 86_400_000).toISOString(),
          )}&to=${encodeURIComponent(new Date().toISOString())}`}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-gray-300 px-4 text-sm font-medium text-gray-700 no-underline transition-colors hover:bg-gray-50 dark:border-white/10 dark:text-graydark-700 dark:hover:bg-white/5"
        >
          <MapIcon size={14} aria-hidden />
          {t('reports.viewOnMap')}
        </RouterLink>
      </div>
    </Modal>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-sm text-gray-500 dark:text-graydark-600">{label}</span>
      <span className="text-sm font-semibold text-gray-800 dark:text-graydark-800">{value}</span>
    </div>
  );
}

function DistanceTable({ range }: { range: ReportRange }) {
  const q = useDistance(range);
  const columns: Column<NonNullable<typeof q.data>['items'][number]>[] = [
    { id: 'label', headerKey: 'reports.cols.vehicle', render: (r) => r.label },
    {
      id: 'distance',
      headerKey: 'reports.cols.distance',
      render: (r) => `${r.distanceKm.toFixed(1)} km`,
    },
    { id: 'trips', headerKey: 'reports.cols.trips', render: (r) => String(r.trips) },
    {
      id: 'avg',
      headerKey: 'reports.cols.avgTrip',
      render: (r) => (r.avgTripKm === null ? '—' : `${r.avgTripKm.toFixed(1)} km`),
    },
    {
      id: 'max',
      headerKey: 'reports.cols.maxTrip',
      render: (r) => (r.maxTripKm === null ? '—' : `${r.maxTripKm.toFixed(1)} km`),
    },
    {
      id: 'discarded',
      headerKey: 'reports.cols.discarded',
      render: (r) => String(r.discardedTrips),
    },
  ];
  if (q.isLoading) return <LoadingLine />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  return (
    <ReportsTable
      columns={columns}
      rows={q.data?.items ?? []}
      rowKey={(r) => r.vehicleId}
      emptyKey="reports.empty"
      dense
    />
  );
}

function SpeedTable({ range }: { range: ReportRange }) {
  const q = useSpeed(range);
  const columns: Column<NonNullable<typeof q.data>['items'][number]>[] = [
    { id: 'label', headerKey: 'reports.cols.vehicle', render: (r) => r.label },
    {
      id: 'avg',
      headerKey: 'reports.cols.avgSpeed',
      render: (r) => (r.avgSpeedKph === null ? '—' : `${r.avgSpeedKph.toFixed(1)} km/h`),
    },
    {
      id: 'max',
      headerKey: 'reports.cols.maxSpeed',
      render: (r) => (r.maxSpeedKph === null ? '—' : `${r.maxSpeedKph.toFixed(0)} km/h`),
    },
    {
      id: 'speeding',
      headerKey: 'reports.cols.speeding',
      render: (r) => String(r.speedingAlarms),
    },
  ];
  if (q.isLoading) return <LoadingLine />;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  return (
    <ReportsTable
      columns={columns}
      rows={q.data?.items ?? []}
      rowKey={(r) => r.vehicleId}
      emptyKey="reports.empty"
      dense
    />
  );
}

function IdleParkingTable({ range }: { range: ReportRange }) {
  const { t } = useTranslation();
  const [kind, setKind] = useState<'IDLE' | 'PARKING' | undefined>(undefined);
  const q = useIdleParking(range, { kind });
  const columns: Column<NonNullable<typeof q.data>['items'][number]>[] = [
    { id: 'kind', headerKey: 'reports.cols.kind', render: (r) => r.kind },
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
    { id: 'duration', headerKey: 'reports.cols.duration', render: (r) => fmtSec(r.durationSec) },
    {
      id: 'status',
      headerKey: 'reports.cols.status',
      render: (r) =>
        r.status ? (
          <Badge color={r.status === 'TAMPER' ? 'danger' : 'gray'}>{r.status}</Badge>
        ) : (
          '—'
        ),
    },
  ];

  const chip = (active: boolean) =>
    `h-7 cursor-pointer rounded-full border px-3 text-xs font-semibold transition-colors ${
      active
        ? 'border-brand-500 bg-brand-500 text-white'
        : 'border-gray-300 bg-transparent text-gray-600 hover:bg-gray-50 dark:border-white/10 dark:text-graydark-700 dark:hover:bg-white/5'
    }`;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-1.5">
        <button
          type="button"
          className={chip(kind === undefined)}
          onClick={() => setKind(undefined)}
        >
          {t('reports.idleParking.all')}
        </button>
        <button type="button" className={chip(kind === 'IDLE')} onClick={() => setKind('IDLE')}>
          {t('reports.idleParking.idle')}
        </button>
        <button
          type="button"
          className={chip(kind === 'PARKING')}
          onClick={() => setKind('PARKING')}
        >
          {t('reports.idleParking.parking')}
        </button>
      </div>
      {q.isLoading ? (
        <LoadingLine />
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
