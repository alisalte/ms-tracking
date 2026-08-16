/**
 * GeofencesSection — geofence event aggregates (Sprint J §14): ENTER/EXIT/
 * DWELL counts + time-inside per geofence × vehicle, from the authoritative
 * Sprint I FleetEvent pipeline (never recomputed from raw GPS — §64).
 */
import { useTranslation } from 'react-i18next';

import { useGeofenceReport, type ReportRange } from '@/api/report.api';
import { ErrorState } from '@/components/common/ErrorState';
import { DataTable, type Column } from '@/components/ui';
import { Stack, Typography } from '@mui/material';

export function GeofencesSection({ range }: { range: ReportRange }) {
  const { t } = useTranslation();
  const q = useGeofenceReport(range);
  const columns: Column<NonNullable<typeof q.data>['items'][number]>[] = [
    { id: 'fence', headerKey: 'reports.cols.geofence', render: (r) => r.geofenceName ?? r.geofenceId ?? '—' },
    { id: 'vehicle', headerKey: 'reports.cols.vehicle', render: (r) => r.label ?? '—' },
    { id: 'enters', headerKey: 'reports.cols.enters', render: (r) => String(r.enters) },
    { id: 'exits', headerKey: 'reports.cols.exits', render: (r) => String(r.exits) },
    { id: 'dwells', headerKey: 'reports.cols.dwells', render: (r) => String(r.dwells) },
    { id: 'inside', headerKey: 'reports.cols.timeInside', render: (r) => fmtDur(r.timeInsideSec) },
  ];
  return (
    <Stack gap={1}>
      {q.isLoading ? (
        <Typography color="text.secondary">{t('common.loading')}</Typography>
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <>
          <DataTable
            columns={columns}
            rows={q.data?.items ?? []}
            rowKey={(r) => `${r.geofenceId ?? 'g'}-${r.vehicleId ?? 'v'}`}
            emptyKey="reports.empty"
            dense
          />
          <Typography variant="caption" color="text.secondary">
            {t('reports.geofence.note')}
          </Typography>
        </>
      )}
    </Stack>
  );
}

function fmtDur(s: number): string {
  if (s <= 0) return '0m';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
