/**
 * ActivitySection — the chronological vehicle activity timeline
 * (Sprint J §15): a UNION of the authoritative trip/idle/parking/geofence/
 * alarm events. Every row shows its SOURCE domain (never conflated).
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useActivity, type ReportRange } from '@/api/report.api';
import { ErrorState } from '@/components/common/ErrorState';
import { Button, Chip, type ChipOwnProps, Stack, Typography } from '@mui/material';

const KIND_TONE: Record<string, 'success' | 'warning' | 'info' | 'danger' | 'neutral'> = {
  TRIP_STARTED: 'success',
  TRIP_ENDED: 'neutral',
  IDLE: 'warning',
  PARKING: 'info',
  GEOFENCE_ENTER: 'info',
  GEOFENCE_EXIT: 'neutral',
  GEOFENCE_DWELL: 'warning',
  ALARM: 'danger',
};

export function ActivitySection({ range }: { range: ReportRange }) {
  const { t } = useTranslation();
  const [vehicleId, setVehicleId] = useState('');
  const q = useActivity(range, vehicleId ? { vehicleId } : {});
  const items = q.data?.items ?? [];
  const vehicles = [...new Map(items.filter((i) => i.vehicleId).map((i) => [i.vehicleId, i.label])).entries()];

  return (
    <Stack gap={1}>
      <Stack direction="row" gap={0.5} flexWrap="wrap">
        <Button
          size="small"
          variant={vehicleId === '' ? 'contained' : 'outlined'}
          onClick={() => setVehicleId('')}
        >
          {t('reports.filters.allVehicles')}
        </Button>
        {vehicles.map(([id, label]) => (
          <Button
            key={id}
            size="small"
            variant={vehicleId === id ? 'contained' : 'outlined'}
            onClick={() => setVehicleId(id as string)}
          >
            {label}
          </Button>
        ))}
      </Stack>
      {q.isLoading ? (
        <Typography color="text.secondary">{t('common.loading')}</Typography>
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : items.length === 0 ? (
        <Typography color="text.secondary" sx={{ py: 4 }} align="center">
          {t('reports.empty')}
        </Typography>
      ) : (
        <Stack gap={0.5} data-testid="report-activity-list">
          {items.map((e, i) => (
            <Stack
              key={`${e.at}-${i}`}
              direction="row"
              gap={1}
              alignItems="center"
              sx={{ borderBottom: 1, borderColor: 'divider', py: 0.5 }}
            >
              <Typography variant="caption" sx={{ fontVariantNumeric: 'tabular-nums', minWidth: 150 }}>
                {new Date(e.at).toLocaleString()}
              </Typography>
              <Chip size="small" label={e.kind} color={chipColor(e.kind)} />
              <Typography variant="body2" noWrap sx={{ minWidth: 110 }}>
                {e.label ?? '—'}
              </Typography>
              <Typography variant="body2" color="text.secondary" noWrap sx={{ flex: 1 }}>
                {e.detail ?? ''}
              </Typography>
              <Typography variant="caption" color="text.secondary" noWrap>
                {e.source}
              </Typography>
            </Stack>
          ))}
        </Stack>
      )}
    </Stack>
  );
}


function chipColor(kind: string): ChipOwnProps['color'] {
  const tone = KIND_TONE[kind];
  if (tone === 'success') return 'success';
  if (tone === 'warning') return 'warning';
  if (tone === 'danger') return 'error';
  if (tone === 'info') return 'info';
  return 'default';
}
