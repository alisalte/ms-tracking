/**
 * ActivitySection — the TailAdmin chronological vehicle activity timeline
 * (Sprint J §15, Phase 8 port): a UNION of the authoritative trip/idle/
 * parking/geofence/alarm events. Every row shows its SOURCE domain (never
 * conflated).
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { type ReportRange, useActivity } from '@/api/report.api';
import { ErrorState } from '@/components/common/ErrorState';
import { Badge } from '@/components/tailwind-ui';

const KIND_TONE: Record<string, 'success' | 'warning' | 'info' | 'danger' | 'gray'> = {
  TRIP_STARTED: 'success',
  TRIP_ENDED: 'gray',
  IDLE: 'warning',
  PARKING: 'info',
  GEOFENCE_ENTER: 'info',
  GEOFENCE_EXIT: 'gray',
  GEOFENCE_DWELL: 'warning',
  ALARM: 'danger',
};

export function ActivitySection({ range }: { range: ReportRange }) {
  const { t } = useTranslation();
  const [vehicleId, setVehicleId] = useState('');
  const q = useActivity(range, vehicleId ? { vehicleId } : {});
  const items = q.data?.items ?? [];
  const vehicles = [
    ...new Map(items.filter((i) => i.vehicleId).map((i) => [i.vehicleId, i.label])).entries(),
  ];

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => setVehicleId('')}
          className={`h-7 cursor-pointer rounded-full border px-3 text-xs font-semibold transition-colors ${
            vehicleId === ''
              ? 'border-brand-500 bg-brand-500 text-white'
              : 'border-gray-300 bg-transparent text-gray-600 hover:bg-gray-50 dark:border-white/10 dark:text-graydark-700 dark:hover:bg-white/5'
          }`}
        >
          {t('reports.filters.allVehicles')}
        </button>
        {vehicles.map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setVehicleId(id as string)}
            className={`h-7 cursor-pointer rounded-full border px-3 text-xs font-semibold transition-colors ${
              vehicleId === id
                ? 'border-brand-500 bg-brand-500 text-white'
                : 'border-gray-300 bg-transparent text-gray-600 hover:bg-gray-50 dark:border-white/10 dark:text-graydark-700 dark:hover:bg-white/5'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {q.isLoading ? (
        <div className="py-2 text-sm text-gray-500 dark:text-graydark-600">
          {t('common.loading')}
        </div>
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white py-10 text-center dark:border-white/5 dark:bg-graydark-300">
          <p className="text-sm text-gray-500 dark:text-graydark-600">{t('reports.empty')}</p>
        </div>
      ) : (
        <div className="flex flex-col" data-testid="report-activity-list">
          {items.map((e, i) => (
            <div
              key={`${e.at}-${i}`}
              className="flex flex-wrap items-center gap-2.5 border-b border-gray-100 py-2 last:border-b-0 dark:border-white/5"
            >
              <span className="min-w-37 text-xs tabular-nums text-gray-500 dark:text-graydark-600">
                {new Date(e.at).toLocaleString()}
              </span>
              <Badge color={KIND_TONE[e.kind] ?? 'gray'}>{e.kind}</Badge>
              <span className="min-w-27 truncate text-sm text-gray-800 dark:text-graydark-800">
                {e.label ?? '—'}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm text-gray-500 dark:text-graydark-600">
                {e.detail ?? ''}
              </span>
              <span className="text-xs whitespace-nowrap text-gray-400 dark:text-graydark-600">
                {e.source}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
