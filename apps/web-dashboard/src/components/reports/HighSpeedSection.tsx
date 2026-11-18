/**
 * HighSpeedSection — "High speeds" (سرعت‌های بالا): every run of stored GPS
 * fixes above the limit, for every vehicle in scope — numbered per vehicle,
 * with start, end, duration, top speed and the place of the top speed.
 * GPS spikes are screened out by the backend and counted, never shown as speeding.
 */
import { AlertTriangle, Gauge, Timer, Truck } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  type FleetScope,
  type OverspeedRowWire,
  type ReportRange,
  exportFleetWorkbook,
  useOverspeedReport,
} from '@/api/report.api';
import { ErrorState } from '@/components/common/ErrorState';
import { KpiTile } from '@/components/dashboard/KpiTile';
import {
  FleetReportToolbar,
  NumberField,
  PlaceCell,
  historyMapUrl,
  useHms,
} from '@/components/reports/FleetReportKit';
import { type Column, ReportsTable } from '@/components/reports/ReportsTable';
import { startEndColumns } from '@/components/reports/dateTimeColumns';
import { Skeleton } from '@/components/tailwind-ui';

export function HighSpeedSection({ range }: { range: ReportRange }) {
  const { t, i18n } = useTranslation();
  const hms = useHms();
  const [scope, setScope] = useState<FleetScope>({});
  const [limitKmh, setLimitKmh] = useState(90);
  // The previous system only listed runs of 3 minutes or more.
  const [minMinutes, setMinMinutes] = useState(3);
  const opts = { limitKmh, minDurationSec: minMinutes * 60 };
  const q = useOverspeedReport(range, scope, opts);
  const data = q.data;

  const columns: Column<OverspeedRowWire>[] = [
    { id: 'seq', header: '#', render: (r) => String(r.seq) },
    { id: 'label', headerKey: 'reports.fleet.vehicleName', render: (r) => r.label },
    ...startEndColumns<OverspeedRowWire>(
      (r) => r.startedAt,
      (r) => r.endedAt,
      i18n.language,
    ),
    { id: 'duration', headerKey: 'reports.cols.duration', render: (r) => hms(r.durationSec) },
    {
      id: 'max',
      headerKey: 'reports.fleet.topSpeed',
      render: (r) => `${Math.round(r.maxSpeedKmh)} km/h`,
    },
    {
      id: 'place',
      headerKey: 'reports.fleet.topSpeedPlace',
      render: (r) => (
        <PlaceCell
          lat={r.peak.lat}
          lng={r.peak.lng}
          mapUrl={historyMapUrl(r.vehicleId, r.startedAt, r.endedAt)}
        />
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4" data-testid="report-highspeed">
      <FleetReportToolbar
        testid="highspeed-toolbar"
        scope={scope}
        onScope={setScope}
        onExport={() =>
          exportFleetWorkbook(
            'overspeed',
            range,
            { ...scope, ...opts },
            i18n.language === 'en' ? 'en' : 'fa',
          )
        }
      >
        <NumberField
          label={t('reports.fleet.limitKmh')}
          value={limitKmh}
          onChange={(v) => v !== null && setLimitKmh(v)}
          min={1}
          max={250}
        />
        <NumberField
          label={t('reports.fleet.minMinutes')}
          value={minMinutes}
          onChange={(v) => v !== null && setMinMinutes(v)}
          min={0}
          max={600}
        />
      </FleetReportToolbar>

      {q.isLoading ? (
        // biome-ignore lint/a11y/useSemanticElements: role=status loading region.
        <div className="flex flex-col gap-3" role="status">
          <Skeleton className="h-[104px] rounded-2xl" />
          <Skeleton className="h-[320px] rounded-2xl" />
        </div>
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : data ? (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <KpiTile
              labelKey="reports.fleet.episodes"
              value={data.summary.episodeCount}
              icon={AlertTriangle}
              tone="danger"
            />
            <KpiTile
              labelKey="reports.fleet.vehiclesInvolved"
              value={data.summary.vehicleCount}
              icon={Truck}
              tone="brand"
            />
            <KpiTile
              labelKey="reports.fleet.topSpeed"
              value={
                data.summary.maxSpeedKmh === null ? null : Math.round(data.summary.maxSpeedKmh)
              }
              suffix=" km/h"
              icon={Gauge}
              tone="warning"
            />
            <KpiTile
              labelKey="reports.fleet.totalMinutes"
              value={Math.round(data.summary.totalDurationSec / 60)}
              icon={Timer}
              tone="info"
            />
          </div>
          {data.truncated && (
            <p className="text-xs text-warning-600">{t('reports.fleet.truncated')}</p>
          )}
          {data.summary.discardedFixCount > 0 && (
            <p className="text-xs text-gray-500 dark:text-graydark-600">
              {t('reports.fleet.discarded', { count: data.summary.discardedFixCount })}
            </p>
          )}
          <ReportsTable
            columns={columns}
            rows={data.items}
            rowKey={(r) => `${r.vehicleId}-${r.startedAt}`}
            emptyKey="reports.fleet.noOverspeed"
            dense
          />
        </>
      ) : null}
    </div>
  );
}
