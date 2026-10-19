import type { TFunction } from 'i18next';
/**
 * GpsCoverageView — "where does the tracker lose the sky?"
 *
 * Paints the project as a grid of squares coloured by GPS signal quality
 * (green good / amber weak / red poor-or-lost) from every recorded fix, and
 * folds in the GPS-loss alarms (signal lost, antenna cut, jamming) at their
 * last known position. The side panel explains the result in plain words and
 * ranks the worst spots; tapping one flies the map there.
 */
import { AlertTriangle, CheckCircle2, MapPinOff, SatelliteDish } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  type AnalyticsFilters,
  type CoverageCell,
  type CoverageLevel,
  useGpsCoverage,
  useGpsLossAlarms,
} from '@/api/analytics.api';
import { ErrorState } from '@/components/common/ErrorState';
import { Card, CardHeader, EmptyState, Skeleton } from '@/components/tailwind-ui';
import { formatNumber } from '@/lib/format-number';
import { mergeLossAlarms, summarizeCoverage, worstCells } from '@/lib/spatial-analytics';

import { AnalyticsMap, type MapCell, type MapPoint } from './AnalyticsMap';
import { StatCard } from './StatCard';

export const LEVEL_COLOR: Record<CoverageLevel, string> = {
  good: '#12B76A',
  fair: '#FDB022',
  poor: '#F04438',
  none: '#98A2B3',
};

/** Plain-text popup for one grid square. */
function coverageTip(t: TFunction, lang: string, c: CoverageCell): string {
  const n = (v: number) => formatNumber(v, lang);
  return [
    `${t(`spatial.coverage.level.${c.level}`)} · ${t('spatial.coverage.score', { score: n(c.score) })}`,
    t('spatial.coverage.tip.points', { n: n(c.points) }),
    c.avgSatellites !== null ? t('spatial.coverage.tip.satellites', { n: n(c.avgSatellites) }) : '',
    c.noFixPoints + c.weakPoints > 0
      ? t('spatial.coverage.tip.weak', { n: n(c.noFixPoints + c.weakPoints) })
      : '',
    c.gaps > 0 ? t('spatial.coverage.tip.gaps', { n: n(c.gaps) }) : '',
    (c.lossAlarms ?? 0) > 0 ? t('spatial.coverage.tip.alarms', { n: n(c.lossAlarms ?? 0) }) : '',
    c.vehicles > 0 ? t('spatial.coverage.tip.vehicles', { n: n(c.vehicles) }) : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export function GpsCoverageView({ filters }: { filters: AnalyticsFilters }) {
  const { t, i18n } = useTranslation();
  const coverage = useGpsCoverage(filters);
  const alarms = useGpsLossAlarms(filters);
  const [focus, setFocus] = useState<{ lat: number; lng: number; nonce: number } | null>(null);
  const n = (v: number) => formatNumber(v, i18n.language);

  const cells = useMemo(
    () =>
      coverage.data
        ? mergeLossAlarms(coverage.data.cells, alarms.data ?? [], coverage.data.cellMeters)
        : [],
    [coverage.data, alarms.data],
  );
  const summary = useMemo(() => summarizeCoverage(cells), [cells]);
  const worst = useMemo(() => worstCells(cells), [cells]);

  const mapCells = useMemo<MapCell[]>(
    () =>
      cells
        .filter((c) => c.level !== 'none')
        .map((c) => ({
          south: c.south,
          west: c.west,
          north: c.north,
          east: c.east,
          color: LEVEL_COLOR[c.level],
          opacity: c.level === 'good' ? 0.35 : 0.6,
          tip: coverageTip(t, i18n.language, c),
        })),
    [cells, t, i18n.language],
  );
  const mapPoints = useMemo<MapPoint[]>(
    () =>
      (alarms.data ?? []).map((a) => ({
        lat: a.lat,
        lng: a.lng,
        color: '#B42318',
        tip: `${t('spatial.coverage.alarmTip')}\n${a.vehicleLabel}\n${new Date(a.raisedAt).toLocaleString(i18n.language)}`,
      })),
    [alarms.data, t, i18n.language],
  );

  if (coverage.isError) {
    return (
      <Card>
        <ErrorState error={coverage.error} onRetry={() => void coverage.refetch()} />
      </Card>
    );
  }

  const loading = coverage.isLoading;
  const empty = !loading && cells.length === 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          icon={CheckCircle2}
          tone="success"
          loading={loading}
          label={t('spatial.coverage.kpi.good')}
          value={`${n(summary.goodShare)}%`}
          hint={t('spatial.coverage.kpi.goodHint', { n: n(summary.good) })}
        />
        <StatCard
          icon={SatelliteDish}
          tone="warning"
          loading={loading}
          label={t('spatial.coverage.kpi.fair')}
          value={n(summary.fair)}
          hint={t('spatial.coverage.kpi.fairHint')}
        />
        <StatCard
          icon={MapPinOff}
          tone="danger"
          loading={loading}
          label={t('spatial.coverage.kpi.poor')}
          value={n(summary.poor)}
          hint={t('spatial.coverage.kpi.poorHint')}
        />
        <StatCard
          icon={AlertTriangle}
          tone="info"
          loading={loading || alarms.isLoading}
          label={t('spatial.coverage.kpi.loss')}
          value={n(summary.lossAlarms + summary.gaps)}
          hint={t('spatial.coverage.kpi.lossHint', {
            alarms: n(summary.lossAlarms),
            gaps: n(summary.gaps),
          })}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card flush className="relative h-[360px] overflow-hidden sm:h-[480px] lg:h-[560px]">
          <AnalyticsMap
            cells={mapCells}
            points={mapPoints}
            fitKey={`${filters.preset}|${filters.vehicleId ?? ''}|${filters.cell}|${cells.length}`}
            focus={focus}
          />
          <Legend />
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-white/60 dark:bg-graydark-200/60">
              <Skeleton className="h-6 w-40" />
            </div>
          )}
          {empty && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-white/70 p-6 dark:bg-graydark-200/70">
              <EmptyState
                icon={<SatelliteDish size={28} />}
                title={t('spatial.coverage.emptyTitle')}
                description={t('spatial.coverage.emptyHelp')}
              />
            </div>
          )}
        </Card>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader title={t('spatial.coverage.whatTitle')} />
            <p className="text-sm leading-7 text-gray-600 dark:text-graydark-700">
              {loading
                ? t('common.loading')
                : empty
                  ? t('spatial.coverage.emptyHelp')
                  : t('spatial.coverage.summary', {
                      share: n(summary.goodShare),
                      poor: n(summary.poor),
                      fair: n(summary.fair),
                    })}
            </p>
            <p className="mt-2 text-xs leading-6 text-gray-500 dark:text-graydark-600">
              {t('spatial.coverage.howTo')}
            </p>
          </Card>

          <Card>
            <CardHeader title={t('spatial.coverage.worstTitle')} />
            {worst.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-graydark-600">
                {loading ? t('common.loading') : t('spatial.coverage.noWorst')}
              </p>
            ) : (
              <ol className="flex flex-col gap-1.5">
                {worst.map((c, i) => (
                  <li key={`${c.lat}:${c.lng}`}>
                    <button
                      type="button"
                      onClick={() => setFocus({ lat: c.lat, lng: c.lng, nonce: Date.now() })}
                      className="flex w-full cursor-pointer items-center gap-3 rounded-xl border border-gray-200 bg-transparent px-3 py-2 text-start transition-colors hover:bg-gray-50 dark:border-white/10 dark:hover:bg-white/5"
                    >
                      <span
                        className="inline-flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
                        style={{ background: LEVEL_COLOR[c.level] }}
                      >
                        {n(i + 1)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-gray-800 dark:text-white">
                          {t(`spatial.coverage.level.${c.level}`)} ·{' '}
                          {t('spatial.coverage.score', { score: n(c.score) })}
                        </span>
                        <span className="block truncate text-xs text-gray-500 dark:text-graydark-600">
                          {[
                            c.gaps + (c.lossAlarms ?? 0) > 0
                              ? t('spatial.coverage.short.loss', {
                                  n: n(c.gaps + (c.lossAlarms ?? 0)),
                                })
                              : '',
                            c.avgSatellites !== null
                              ? t('spatial.coverage.short.sats', { n: n(c.avgSatellites) })
                              : '',
                            c.vehicles > 0
                              ? t('spatial.coverage.short.vehicles', { n: n(c.vehicles) })
                              : '',
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function Legend() {
  const { t } = useTranslation();
  return (
    <div className="pointer-events-none absolute bottom-2 start-2 flex max-w-[calc(100%-4rem)] flex-wrap gap-x-3 gap-y-1 rounded-xl bg-white/90 px-3 py-2 text-[0.7rem] font-semibold text-gray-700 shadow-md dark:bg-graydark-300/90 dark:text-graydark-800">
      {(['good', 'fair', 'poor'] as const).map((l) => (
        <span key={l} className="inline-flex items-center gap-1.5">
          <span className="size-3 rounded-sm" style={{ background: LEVEL_COLOR[l] }} />
          {t(`spatial.coverage.level.${l}`)}
        </span>
      ))}
      <span className="inline-flex items-center gap-1.5">
        <span className="size-3 rounded-full border-2 border-white bg-[#B42318]" />
        {t('spatial.coverage.legendAlarm')}
      </span>
    </div>
  );
}
