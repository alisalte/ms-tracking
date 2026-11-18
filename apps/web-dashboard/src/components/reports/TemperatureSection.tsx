/**
 * TemperatureSection — "Allowed temperature" (دمای مجاز): every period a cargo /
 * fridge probe read outside the allowed band, for every vehicle in scope —
 * numbered per vehicle, with start, end, duration, the lowest and highest
 * reading and where the period began.
 *
 * Probes: Meitrack CCE temperature slots and Teltonika 1-Wire / LLS probes.
 * Vehicles without a probe are listed separately so "no violation" is never
 * confused with "no data".
 */
import { Thermometer, ThermometerSnowflake, Timer, Truck } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  type FleetScope,
  type ReportRange,
  type TemperatureRowWire,
  exportFleetWorkbook,
  useTemperatureReport,
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

/** Upper bound of the legacy "allowed temperature" report. */
const DEFAULT_MAX_C = 16;

function sensorName(sensor: string): string {
  const m = /^(?:temp|cce)(\d+)$/.exec(sensor);
  if (m) return `T${m[1]}`;
  const lls = /^lls(\d)Temp$/.exec(sensor);
  if (lls) return `LLS${lls[1]}`;
  if (/^ain\d+$/.test(sensor)) return sensor.toUpperCase();
  return sensor;
}

function probeName(sensor: string, label: string | null): string {
  return label ?? sensorName(sensor);
}

const celsius = (c: number | null) => (c === null ? '—' : `${c.toFixed(1)} °C`);

export function TemperatureSection({ range }: { range: ReportRange }) {
  const { t, i18n } = useTranslation();
  const hms = useHms();
  const [scope, setScope] = useState<FleetScope>({});
  const [minC, setMinC] = useState<number | null>(null);
  const [maxC, setMaxC] = useState<number | null>(DEFAULT_MAX_C);
  const [minMinutes, setMinMinutes] = useState(0);
  const opts = { minC, maxC, minDurationSec: minMinutes * 60 };
  const q = useTemperatureReport(range, scope, opts);
  const data = q.data;
  const noBand = minC === null && maxC === null;

  const columns: Column<TemperatureRowWire>[] = [
    { id: 'seq', header: '#', render: (r) => String(r.seq) },
    { id: 'label', headerKey: 'reports.fleet.vehicleName', render: (r) => r.label },
    {
      id: 'sensor',
      headerKey: 'reports.fleet.sensor',
      render: (r) => probeName(r.sensor, r.sensorLabel),
    },
    {
      id: 'kind',
      headerKey: 'reports.fleet.kind',
      render: (r) => (
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
            r.kind === 'HIGH'
              ? 'bg-error-50 text-error-600 dark:bg-error-500/15 dark:text-error-400'
              : 'bg-info-50 text-info-600 dark:bg-info-500/15 dark:text-info-300'
          }`}
        >
          {t(r.kind === 'HIGH' ? 'reports.fleet.high' : 'reports.fleet.low')}
        </span>
      ),
    },
    ...startEndColumns<TemperatureRowWire>(
      (r) => r.startedAt,
      (r) => r.endedAt,
      i18n.language,
    ),
    { id: 'duration', headerKey: 'reports.cols.duration', render: (r) => hms(r.durationSec) },
    { id: 'min', headerKey: 'reports.fleet.minTemp', render: (r) => celsius(r.minC) },
    { id: 'max', headerKey: 'reports.fleet.maxTemp', render: (r) => celsius(r.maxC) },
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
    <div className="flex flex-col gap-4" data-testid="report-temperature">
      <FleetReportToolbar
        testid="temperature-toolbar"
        scope={scope}
        onScope={setScope}
        onExport={() =>
          exportFleetWorkbook(
            'temperature',
            range,
            {
              ...scope,
              ...(minC !== null ? { minC } : {}),
              ...(maxC !== null ? { maxC } : {}),
              minDurationSec: minMinutes * 60,
            },
            i18n.language === 'en' ? 'en' : 'fa',
          )
        }
      >
        <NumberField
          label={t('reports.fleet.minAllowed')}
          value={minC}
          onChange={setMinC}
          min={-100}
          max={200}
          step={0.5}
          allowEmpty
        />
        <NumberField
          label={t('reports.fleet.maxAllowed')}
          value={maxC}
          onChange={setMaxC}
          min={-100}
          max={200}
          step={0.5}
          allowEmpty
        />
        <NumberField
          label={t('reports.fleet.minMinutes')}
          value={minMinutes}
          onChange={(v) => v !== null && setMinMinutes(v)}
          min={0}
          max={600}
        />
      </FleetReportToolbar>

      {noBand ? (
        <p className="rounded-lg bg-gray-50 p-3 text-sm dark:bg-white/5">
          {t('reports.fleet.needBand')}
        </p>
      ) : q.isLoading ? (
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
              labelKey="reports.fleet.tempEpisodes"
              value={data.summary.episodeCount}
              icon={Thermometer}
              tone="danger"
            />
            <KpiTile
              labelKey="reports.fleet.vehiclesWithSensors"
              value={data.summary.vehiclesWithSensors}
              icon={Truck}
              tone="brand"
            />
            <KpiTile
              labelKey="reports.fleet.highest"
              value={data.summary.highestC}
              suffix=" °C"
              icon={Thermometer}
              tone="warning"
            />
            <KpiTile
              labelKey="reports.fleet.lowest"
              value={data.summary.lowestC}
              suffix=" °C"
              icon={ThermometerSnowflake}
              tone="info"
            />
          </div>
          <p className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-graydark-600">
            <Timer size={13} aria-hidden="true" />
            {t('reports.fleet.outOfRangeTotal', { time: hms(data.summary.totalDurationSec) })}
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
                ? 'reports.fleet.noSensors'
                : 'reports.fleet.noTempEpisodes'
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
                        {s.label} · {probeName(s.sensor, s.sensorLabel)}
                      </span>
                      <span dir="ltr">
                        {celsius(s.minC)} … {celsius(s.maxC)}
                      </span>
                      <span className="text-gray-500">
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
