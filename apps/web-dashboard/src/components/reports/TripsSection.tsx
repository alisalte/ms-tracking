/**
 * TripsSection — the trip report table (Sprint J §9): real backend rows,
 * View-on-Map deep link into the existing history map (§38), CSV export
 * (§31). Vehicle + fleet filters; bounded pages (cursor).
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { exportReportCsv, useTrips, type ReportRange } from '@/api/report.api';
import { getApiErrorMessage } from '@/api/errors';
import { ErrorState } from '@/components/common/ErrorState';
import { useToast } from '@/components/feedback/ToastProvider';
import { DataTable, type Column } from '@/components/ui';
import { Button, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { Download, Map as MapIcon } from 'lucide-react';

export function TripsSection({ range }: { range: ReportRange }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [vehicleId, setVehicleId] = useState('');
  const [exporting, setExporting] = useState(false);
  const q = useTrips(range, vehicleId ? { vehicleId } : {});

  const columns: Column<NonNullable<typeof q.data>['items'][number]>[] = [
    { id: 'label', headerKey: 'reports.cols.vehicle', render: (r) => r.label },
    { id: 'start', headerKey: 'reports.cols.start', render: (r) => new Date(r.startedAt).toLocaleString() },
    { id: 'end', headerKey: 'reports.cols.end', render: (r) => (r.endedAt ? new Date(r.endedAt).toLocaleString() : '—') },
    { id: 'duration', headerKey: 'reports.cols.duration', render: (r) => fmtDur(r.durationSec) },
    { id: 'distance', headerKey: 'reports.cols.distance', render: (r) => `${r.distanceKm.toFixed(1)} km` },
    { id: 'avg', headerKey: 'reports.cols.avgSpeed', render: (r) => (r.avgSpeedKph === null ? '—' : `${r.avgSpeedKph.toFixed(1)} km/h`) },
    { id: 'max', headerKey: 'reports.cols.maxSpeed', render: (r) => `${r.maxSpeedKph.toFixed(0)} km/h` },
    { id: 'idle', headerKey: 'reports.cols.idle', render: (r) => fmtDur(r.idleSec) },
    { id: 'parking', headerKey: 'reports.cols.parking', render: (r) => fmtDur(r.parkingSec) },
    {
      id: 'actions',
      header: '',
      render: (r) => (
        <Button
          size="small"
          startIcon={<MapIcon size={13} />}
          component="a"
          href={`/map?vehicle=${encodeURIComponent(r.vehicleId)}&from=${encodeURIComponent(
            r.startedAt,
          )}&to=${encodeURIComponent(r.endedAt ?? new Date().toISOString())}`}
          onClick={(e) => {
            e.preventDefault();
            window.location.href = `/map?vehicle=${encodeURIComponent(r.vehicleId)}&from=${encodeURIComponent(
              r.startedAt,
            )}&to=${encodeURIComponent(r.endedAt ?? new Date().toISOString())}`;
          }}
          data-testid="report-trip-view-map"
        >
          {t('reports.viewOnMap')}
        </Button>
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
    <Stack gap={1}>
      <Stack direction={{ xs: 'column', sm: 'row' }} gap={1} alignItems={{ sm: 'center' }} justifyContent="space-between">
        <TextField
          size="small"
          label={t('reports.filters.vehicleId')}
          value={vehicleId}
          onChange={(e) => setVehicleId(e.target.value)}
          sx={{ minWidth: 260 }}
          select
          slotProps={{ htmlInput: { 'aria-label': t('reports.filters.vehicleId') } }}
        >
          <MenuItem value="">{t('reports.filters.allVehicles')}</MenuItem>
          {[...new Map((q.data?.items ?? []).map((r) => [r.vehicleId, r.label])).entries()].map(
            ([id, label]) => (
              <MenuItem key={id} value={id}>
                {label}
              </MenuItem>
            ),
          )}
        </TextField>
        <Button
          size="small"
          startIcon={<Download size={14} />}
          onClick={doExport}
          disabled={exporting || q.isLoading}
          data-testid="report-export-trips"
        >
          {exporting ? t('reports.export.exporting') : t('reports.export.csv')}
        </Button>
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

function fmtDur(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
