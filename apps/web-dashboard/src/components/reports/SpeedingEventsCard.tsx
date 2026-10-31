/**
 * SpeedingEventsCard — evidence behind a speeding figure.
 *
 * For one vehicle it lists every run of stored GPS fixes above the limit
 * (start / end, duration, peak, average, place, driver, the alarm the engine
 * recorded) and lets the reader open the raw fixes of each run. It only shows
 * what the device really reported: with no fix above the limit it says so and
 * prints the real top speed instead of an event.
 */
import { ChevronDown, ChevronUp, MapPin } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  type ReportRange,
  type SpeedRowWire,
  type SpeedingEpisodeWire,
  useSpeedingEvents,
} from '@/api/report.api';
import { ErrorState } from '@/components/common/ErrorState';
import { Card, CardHeader } from '@/components/tailwind-ui';
import { formatDateTime } from '@/lib/format-date';
import { formatDurationSec } from '@/lib/report-format';

const DEFAULT_LIMIT_KMH = 80;

const osmUrl = (lat: number, lng: number) =>
  `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=16/${lat}/${lng}`;

export function SpeedingEventsCard({
  range,
  vehicles,
}: {
  range: ReportRange;
  vehicles: readonly SpeedRowWire[];
}) {
  const { t } = useTranslation();
  const [vehicleId, setVehicleId] = useState('');
  const [limitKmh, setLimitKmh] = useState(DEFAULT_LIMIT_KMH);
  const [open, setOpen] = useState<string | null>(null);
  const q = useSpeedingEvents(range, vehicleId, limitKmh);
  const data = q.data;

  return (
    <Card>
      <CardHeader title={t('reports.speeding.title')} />
      <div className="flex flex-col gap-3 p-4 pt-0" data-testid="report-speeding-events">
        <p className="text-xs text-gray-500 dark:text-graydark-600">{t('reports.speeding.hint')}</p>
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label={t('reports.cols.vehicle')}
            value={vehicleId}
            onChange={(e) => {
              setVehicleId(e.target.value);
              setOpen(null);
            }}
            className="h-9 min-w-48 rounded-lg border border-gray-300 bg-transparent px-2 text-sm dark:border-white/10"
          >
            <option value="">{t('reports.speeding.pickVehicle')}</option>
            {vehicles.map((v) => (
              <option key={v.vehicleId} value={v.vehicleId}>
                {v.label}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-graydark-700">
            {t('reports.speeding.limit')}
            <input
              type="number"
              min={1}
              max={250}
              value={limitKmh}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (Number.isFinite(n) && n >= 1 && n <= 250) setLimitKmh(n);
              }}
              className="h-9 w-20 rounded-lg border border-gray-300 bg-transparent px-2 text-sm dark:border-white/10"
            />
          </label>
        </div>

        {vehicleId === '' ? null : q.isLoading ? (
          <p className="text-sm text-gray-500">{t('common.loading')}</p>
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : data ? (
          <>
            <dl className="grid grid-cols-2 gap-3 text-sm md:grid-cols-5">
              <Stat
                label={t('reports.speeding.episodes')}
                value={String(data.summary.episodeCount)}
              />
              <Stat
                label={t('reports.speeding.overFixes')}
                value={String(data.summary.overLimitFixCount)}
              />
              <Stat
                label={t('reports.speeding.maxInEpisodes')}
                value={kmh(data.summary.maxSpeedKmh)}
              />
              <Stat
                label={t('reports.speeding.maxReported')}
                value={kmh(data.summary.maxReportedKmh)}
              />
              <Stat label={t('reports.speeding.alarms')} value={String(data.summary.alarmCount)} />
            </dl>

            {data.truncated && (
              <p className="text-xs text-warning-600">{t('reports.speeding.truncated')}</p>
            )}

            {data.episodes.length === 0 ? (
              <p className="rounded-lg bg-gray-50 p-3 text-sm dark:bg-white/5">
                {data.summary.positionCount === 0
                  ? t('reports.speeding.noFixes')
                  : t('reports.speeding.none', {
                      limit: data.limitKmh,
                      max: kmh(data.summary.maxReportedKmh),
                    })}
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {data.episodes.map((e) => (
                  <EpisodeRow
                    key={e.startedAt}
                    episode={e}
                    expanded={open === e.startedAt}
                    onToggle={() => setOpen(open === e.startedAt ? null : e.startedAt)}
                  />
                ))}
              </div>
            )}
          </>
        ) : null}
      </div>
    </Card>
  );
}

function kmh(v: number | null): string {
  return v === null ? '—' : `${v.toFixed(0)} km/h`;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-gray-500 dark:text-graydark-600">{label}</dt>
      <dd className="text-base font-semibold">{value}</dd>
    </div>
  );
}

function EpisodeRow({
  episode: e,
  expanded,
  onToggle,
}: {
  episode: SpeedingEpisodeWire;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const alarm = e.alarms[0];
  return (
    <div
      className="rounded-xl border border-gray-200 p-3 dark:border-white/10"
      data-testid="speeding-episode"
    >
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm md:grid-cols-4">
        <Stat label={t('reports.speeding.start')} value={formatDateTime(e.startedAt)} />
        <Stat label={t('reports.speeding.end')} value={formatDateTime(e.endedAt)} />
        <Stat label={t('reports.speeding.duration')} value={formatDurationSec(e.durationSec)} />
        <Stat label={t('reports.speeding.peak')} value={kmh(e.maxSpeedKmh)} />
        <Stat label={t('reports.speeding.avg')} value={kmh(e.avgSpeedKmh)} />
        <Stat label={t('reports.speeding.over')} value={`+${e.overLimitKmh.toFixed(0)} km/h`} />
        <Stat label={t('reports.speeding.driver')} value={e.driver ?? '—'} />
        <Stat
          label={t('reports.speeding.alarmCol')}
          value={alarm ? `${alarm.severity} · ${alarm.status}` : t('reports.speeding.noAlarm')}
        />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <a
          href={osmUrl(e.peak.lat, e.peak.lng)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-xs font-semibold text-brand-500"
        >
          <MapPin size={14} aria-hidden="true" />
          {t('reports.speeding.map')}
        </a>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="inline-flex cursor-pointer items-center gap-1 text-xs font-semibold text-gray-600 dark:text-graydark-700"
        >
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          {t('reports.speeding.fixes')} ({e.fixCount})
        </button>
      </div>
      {expanded && (
        <ul className="mt-2 max-h-56 overflow-auto text-xs" data-testid="speeding-fixes">
          {e.fixes.map((f) => (
            <li
              key={f.at}
              className="flex justify-between gap-3 border-b border-gray-100 py-1 last:border-b-0 dark:border-white/5"
            >
              <span>{formatDateTime(f.at)}</span>
              <span className="font-semibold">{kmh(f.speedKmh)}</span>
              <span className="text-gray-500">
                {f.lat.toFixed(5)}, {f.lng.toFixed(5)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
