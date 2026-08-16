/**
 * VehiclesSection — utilization / distance / speed / idle-parking tables
 * (Sprint J §7/§8/§10/§11) + the vehicle report detail drawer (§37) + CSV
 * export for utilization. All numbers are backend KPIs; null utilization
 * renders "—" with the no-data note (never a fake zero).
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink } from 'react-router';

import {
  exportReportCsv,
  useDistance,
  useIdleParking,
  useSpeed,
  useUtilization,
  type ReportRange,
  type UtilizationRowWire,
} from '@/api/report.api';
import { ErrorState } from '@/components/common/ErrorState';
import { useToast } from '@/components/feedback/ToastProvider';
import { DataTable, StatusBadge, type Column } from '@/components/ui';
import { getApiErrorMessage } from '@/api/errors';
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Tab,
  Tabs,
  Typography,
} from '@mui/material';
import { Download, Map as MapIcon } from 'lucide-react';

function fmtSec(s: number | null): string {
  if (s === null) return '—';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function VehiclesSection({ range }: { range: ReportRange }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState(0);
  return (
    <Stack gap={2}>
      <Tabs value={tab} onChange={(_, v: number) => setTab(v)} aria-label={t('reports.vehicles.tabs')}>
        <Tab label={t('reports.vehicles.utilization')} data-testid="report-tab-utilization" />
        <Tab label={t('reports.distance.title')} />
        <Tab label={t('reports.speed.title')} />
        <Tab label={t('reports.idleParking.title')} />
      </Tabs>
      {tab === 0 && <UtilizationTable range={range} />}
      {tab === 1 && <DistanceTable range={range} />}
      {tab === 2 && <SpeedTable range={range} />}
      {tab === 3 && <IdleParkingTable range={range} />}
    </Stack>
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
    {
      id: 'observed',
      headerKey: 'reports.cols.observed',
      render: (r) => fmtSec(r.observedSec),
    },
    {
      id: 'utilization',
      headerKey: 'reports.cols.utilization',
      render: (r) =>
        r.utilizationPct === null ? '—' : `${r.utilizationPct.toFixed(1)}%`,
    },
    { id: 'distance', headerKey: 'reports.cols.distance', render: (r) => `${r.distanceKm.toFixed(1)} km` },
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
    <Stack gap={1}>
      <Stack direction="row" justifyContent="flex-end">
        <Button
          size="small"
          startIcon={<Download size={14} />}
          onClick={doExport}
          disabled={exporting || q.isLoading}
          data-testid="report-export-utilization"
        >
          {exporting ? t('reports.export.exporting') : t('reports.export.csv')}
        </Button>
      </Stack>
      {q.isLoading ? (
        <Typography color="text.secondary">{t('common.loading')}</Typography>
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <>
          <DataTable
            columns={columns}
            rows={q.data?.items ?? []}
            rowKey={(r) => r.vehicleId}
            onRowClick={(r) => setDetail(r)}
            emptyKey="reports.empty"
            dense
          />
          <Typography variant="caption" color="text.secondary">
            {t('reports.utilization.note')}
          </Typography>
        </>
      )}
      <VehicleDetailDialog row={detail} onClose={() => setDetail(null)} />
    </Stack>
  );
}

function VehicleDetailDialog({ row, onClose }: { row: UtilizationRowWire | null; onClose: () => void }) {
  const { t } = useTranslation();
  if (!row) return null;
  return (
    <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{row.label}</DialogTitle>
      <DialogContent>
        <Stack gap={1} sx={{ mt: 1 }}>
          <Row label={t('reports.cols.moving')} value={fmtSec(row.movingSec)} />
          <Row label={t('reports.cols.idle')} value={fmtSec(row.idleSec)} />
          <Row label={t('reports.cols.parking')} value={fmtSec(row.parkingSec)} />
          <Row label={t('reports.cols.observed')} value={fmtSec(row.observedSec)} />
          <Row
            label={t('reports.cols.utilization')}
            value={row.utilizationPct === null ? `— (${t('reports.noData')})` : `${row.utilizationPct.toFixed(1)}%`}
          />
          <Row label={t('reports.cols.distance')} value={`${row.distanceKm.toFixed(1)} km`} />
          <Row label={t('reports.cols.trips')} value={String(row.trips)} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button
          component={RouterLink}
          to={`/map?vehicle=${encodeURIComponent(row.vehicleId)}&from=${encodeURIComponent(
            new Date(Date.now() - 7 * 86_400_000).toISOString(),
          )}&to=${encodeURIComponent(new Date().toISOString())}`}
          startIcon={<MapIcon size={14} />}
          size="small"
        >
          {t('reports.viewOnMap')}
        </Button>
        <Button onClick={onClose}>{t('common.close')}</Button>
      </DialogActions>
    </Dialog>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <Stack direction="row" justifyContent="space-between">
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="body2" fontWeight={600}>
        {value}
      </Typography>
    </Stack>
  );
}

function DistanceTable({ range }: { range: ReportRange }) {
  const { t } = useTranslation();
  const q = useDistance(range);
  const columns: Column<NonNullable<typeof q.data>['items'][number]>[] = [
    { id: 'label', headerKey: 'reports.cols.vehicle', render: (r) => r.label },
    { id: 'distance', headerKey: 'reports.cols.distance', render: (r) => `${r.distanceKm.toFixed(1)} km` },
    { id: 'trips', headerKey: 'reports.cols.trips', render: (r) => String(r.trips) },
    { id: 'avg', headerKey: 'reports.cols.avgTrip', render: (r) => (r.avgTripKm === null ? '—' : `${r.avgTripKm.toFixed(1)} km`) },
    { id: 'max', headerKey: 'reports.cols.maxTrip', render: (r) => (r.maxTripKm === null ? '—' : `${r.maxTripKm.toFixed(1)} km`) },
    { id: 'discarded', headerKey: 'reports.cols.discarded', render: (r) => String(r.discardedTrips) },
  ];
  if (q.isLoading) return <Typography color="text.secondary">{t('common.loading')}</Typography>;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  return (
    <DataTable
      columns={columns}
      rows={q.data?.items ?? []}
      rowKey={(r) => r.vehicleId}
      emptyKey="reports.empty"
      dense
    />
  );
}

function SpeedTable({ range }: { range: ReportRange }) {
  const { t } = useTranslation();
  const q = useSpeed(range);
  const columns: Column<NonNullable<typeof q.data>['items'][number]>[] = [
    { id: 'label', headerKey: 'reports.cols.vehicle', render: (r) => r.label },
    { id: 'avg', headerKey: 'reports.cols.avgSpeed', render: (r) => (r.avgSpeedKph === null ? '—' : `${r.avgSpeedKph.toFixed(1)} km/h`) },
    { id: 'max', headerKey: 'reports.cols.maxSpeed', render: (r) => (r.maxSpeedKph === null ? '—' : `${r.maxSpeedKph.toFixed(0)} km/h`) },
    { id: 'speeding', headerKey: 'reports.cols.speeding', render: (r) => String(r.speedingAlarms) },
  ];
  if (q.isLoading) return <Typography color="text.secondary">{t('common.loading')}</Typography>;
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  return (
    <DataTable
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
    { id: 'start', headerKey: 'reports.cols.start', render: (r) => new Date(r.startedAt).toLocaleString() },
    { id: 'end', headerKey: 'reports.cols.end', render: (r) => (r.endedAt ? new Date(r.endedAt).toLocaleString() : '—') },
    { id: 'duration', headerKey: 'reports.cols.duration', render: (r) => fmtSec(r.durationSec) },
    {
      id: 'status',
      headerKey: 'reports.cols.status',
      render: (r) =>
        r.status ? <StatusBadge label={r.status} tone={r.status === 'TAMPER' ? 'danger' : 'neutral'} /> : '—',
    },
  ];
  return (
    <Stack gap={1}>
      <Stack direction="row" gap={1}>
        <Chip label={t('reports.idleParking.all')} onClick={() => setKind(undefined)} color={kind === undefined ? 'primary' : 'default'} size="small" />
        <Chip label={t('reports.idleParking.idle')} onClick={() => setKind('IDLE')} color={kind === 'IDLE' ? 'primary' : 'default'} size="small" />
        <Chip label={t('reports.idleParking.parking')} onClick={() => setKind('PARKING')} color={kind === 'PARKING' ? 'primary' : 'default'} size="small" />
      </Stack>
      {q.isLoading ? (
        <Typography color="text.secondary">{t('common.loading')}</Typography>
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <DataTable
          columns={columns}
          rows={q.data?.items ?? []}
          rowKey={(r) => r.id}
          emptyKey="reports.empty"
          dense
        />
      )}
    </Stack>
  );
}

export { Box };
