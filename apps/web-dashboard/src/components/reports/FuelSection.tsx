/**
 * FuelSection — "Fuel" (سوخت): every refill and abnormal level drop of every
 * vehicle in scope — numbered per vehicle, with start, end, the level before
 * and after, the change in percent and litres (when the tank size is known)
 * and where the event began.
 *
 * Levels come from configured analog fuel senders (`io_sensors`), CAN fuel
 * percent and the Meitrack CCE fuel percentage. Normal consumption over the
 * 10-minute detection window stays below the threshold and is not listed.
 */
import { Fuel, TrendingDown, TrendingUp, Truck } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  type FleetScope,
  type FuelRowWire,
  type ReportRange,
  exportFleetWorkbook,
  useFuelReport,
} from '@/api/report.api';
import { ErrorState } from '@/components/common/ErrorState';
import { KpiTile } from '@/components/dashboard/KpiTile';
import {
  FleetReportToolbar,
  NumberField,
  PlaceCell,
  historyMapUrl,
} from '@/components/reports/FleetReportKit';
import { type Column, ReportsTable } from '@/components/reports/ReportsTable';
import { startEndColumns } from '@/components/reports/dateTimeColumns';
import { Skeleton } from '@/components/tailwind-ui';

/** Minimum level change that is a fill / drop rather than consumption. */
const DEFAULT_MIN_DELTA_PCT = 8;

const pct = (n: number) => `${n > 0 ? '+' : ''}${n.toFixed(1)} %`;
const liters = (n: number | null) => (n === null ? '—' : `${n.toFixed(1)} L`);

export function FuelSection({ range }: { range: ReportRange }) {
  const { t, i18n } = useTranslation();
  const [scope, setScope] = useState<FleetScope>({});
  const [minDeltaPct, setMinDeltaPct] = useState(DEFAULT_MIN_DELTA_PCT);
  const opts = { minDeltaPct };
  const q = useFuelReport(range, scope, opts);
  const data = q.data;

  const columns: Column<FuelRowWire>[] = [
    { id: 'seq', header: '#', render: (r) => String(r.seq) },
    { id: 'label', headerKey: 'reports.fleet.vehicleName', render: (r) => r.label },
    { id: 'sensor', headerKey: 'reports.fleet.sensor', render: (r) => r.sensorLabel },
    {
      id: 'kind',
      headerKey: 'reports.fleet.kind',
      render: (r) => (
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
            r.kind === 'FILL'
              ? 'bg-success-50 text-success-600 dark:bg-success-500/15 dark:text-success-400'
              : 'bg-error-50 text-error-600 dark:bg-error-500/15 dark:text-error-400'
          }`}
        >
          {t(r.kind === 'FILL' ? 'reports.fleet.refill' : 'reports.fleet.fuelDrop')}
        </span>
      ),
    },
    ...startEndColumns<FuelRowWire>(
      (r) => r.startedAt,
      (r) => r.endedAt,
      i18n.language,
    ),
    { id: 'before', headerKey: 'reports.fleet.levelBefore', render: (r) => pct(r.startPct) },
    { id: 'after', headerKey: 'reports.fleet.levelAfter', render: (r) => pct(r.endPct) },
    {
      id: 'delta',
      headerKey: 'reports.fleet.deltaPct',
      render: (r) => <span dir="ltr">{pct(r.deltaPct)}</span>,
    },
    { id: 'liters', headerKey: 'reports.fleet.deltaL', render: (r) => liters(r.deltaL) },
    {
      id: 'place',
      headerKey: 'reports.fleet.place',
      render: (r) => (
        <PlaceCell
          lat={r.start.lat}
          lng={r.start.lng}
          mapUrl={historyMapUrl(r.vehicleId, r.startedAt, r.endedAt)}
        />
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4" data-testid="report-fuel">
      <FleetReportToolbar
        testid="fuel-toolbar"
        scope={scope}
        onScope={setScope}
        onExport={() =>
          exportFleetWorkbook(
            'fuel',
            range,
            { ...scope, minDeltaPct },
            i18n.language === 'en' ? 'en' : 'fa',
          )
        }
      >
        <NumberField
          label={t('reports.fleet.minDeltaPct')}
          value={minDeltaPct}
          onChange={(v) => v !== null && setMinDeltaPct(v)}
          min={1}
          max={100}
          step={0.5}
          width="w-28"
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
              labelKey="reports.fleet.fuelEvents"
              value={data.summary.eventCount}
              icon={Fuel}
              tone="danger"
            />
            <KpiTile
              labelKey="reports.fleet.vehiclesWithSensors"
              value={data.summary.vehiclesWithSensors}
              icon={Truck}
              tone="brand"
            />
            <KpiTile
              labelKey="reports.fleet.refills"
              value={data.summary.fillCount}
              icon={TrendingUp}
              tone="warning"
            />
            <KpiTile
              labelKey="reports.fleet.fuelDrops"
              value={data.summary.dropCount}
              icon={TrendingDown}
              tone="info"
            />
          </div>
          <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500 dark:text-graydark-600">
            <span>
              {t('reports.fleet.filledTotal')}: {liters(data.summary.totalFilledL)}
            </span>
            <span>
              {t('reports.fleet.droppedTotal')}: {liters(data.summary.totalDroppedL)}
            </span>
          </p>
          {data.truncated && (
            <p className="text-xs text-warning-600">{t('reports.fleet.truncated')}</p>
          )}
          <ReportsTable
            columns={columns}
            rows={data.items}
            rowKey={(r) => `${r.vehicleId}-${r.sensor}-${r.startedAt}`}
            emptyKey={
              data.summary.vehiclesWithSensors === 0
                ? 'reports.fleet.noFuelSensors'
                : 'reports.fleet.noFuelEvents'
            }
            dense
          />
          {data.sensors.length > 0 && (
            <details className="rounded-xl border border-gray-200 p-3 text-xs dark:border-white/10">
              <summary className="cursor-pointer text-gray-600 dark:text-graydark-700">
                {t('reports.fleet.sensorSummary', { count: data.sensors.length })}
              </summary>
              <ul className="mt-2 max-h-64 overflow-auto">
                {[...data.sensors]
                  .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }))
                  .map((s) => (
                    <li
                      key={`${s.vehicleId}-${s.sensor}`}
                      className="flex flex-wrap justify-between gap-3 border-b border-gray-100 py-1 last:border-b-0 dark:border-white/5"
                    >
                      <span>
                        {s.label} · {s.sensorLabel}
                      </span>
                      <span dir="ltr">
                        {pct(s.minPct)} … {pct(s.maxPct)}
                      </span>
                      <span className="text-gray-500">
                        {t('reports.fleet.lastLevel', { level: pct(s.lastPct) })} ·{' '}
                        {t('reports.fleet.readings', { count: s.readings })}
                      </span>
                    </li>
                  ))}
              </ul>
            </details>
          )}
        </>
      ) : null}
    </div>
  );
}
