/**
 * MovementPatternsView — "where and when does the fleet actually work?"
 *
 * From the position history it derives:
 * - the project working area (dashed outline = hull of the cells that hold
 *   95% of all activity, so one-off detours do not inflate it),
 * - an activity heatmap and the top stop / waiting spots,
 * - when the fleet drives (hour-of-day bars + weekday × hour grid),
 * - a per-vehicle table (distance, driving vs stopped time, range covered),
 * and states the main findings as plain sentences.
 */
import type { EChartsOption } from 'echarts';
import { Gauge, Lightbulb, MapPinned, Route, Truck } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { type AnalyticsFilters, useMovementPatterns } from '@/api/analytics.api';
import { ErrorState } from '@/components/common/ErrorState';
import { EChart } from '@/components/dashboard/EChart';
import { Card, CardHeader, EmptyState, Skeleton } from '@/components/tailwind-ui';
import { useVehicleCaptionOf } from '@/hooks/useVehicleCaptionOf';
import { formatNumber } from '@/lib/format-number';
import { activityColor, activityShare, hoursOf, movementInsights } from '@/lib/spatial-analytics';
import { chart } from '@/theme/palette';

import { AnalyticsMap, type MapCell, type MapPoint } from './AnalyticsMap';
import { StatCard } from './StatCard';

/** Postgres DOW (0 = Sunday) → a localized short weekday name. */
function weekdayName(dow: number, lang: string): string {
  // 2026-01-04 is a Sunday.
  return new Intl.DateTimeFormat(lang, { weekday: 'short' }).format(new Date(2026, 0, 4 + dow));
}

/** Week order: Saturday-first for Persian, Monday-first otherwise. */
function weekOrder(lang: string): number[] {
  return lang.startsWith('fa') ? [6, 0, 1, 2, 3, 4, 5] : [1, 2, 3, 4, 5, 6, 0];
}

export function MovementPatternsView({ filters }: { filters: AnalyticsFilters }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const movement = useMovementPatterns(filters);
  const captionOf = useVehicleCaptionOf();
  const [focus, setFocus] = useState<{ lat: number; lng: number; nonce: number } | null>(null);
  const n = useCallback(
    (v: number, digits = 0) =>
      formatNumber(v, lang, { maximumFractionDigits: digits, minimumFractionDigits: 0 }),
    [lang],
  );

  const pad2 = useCallback(
    (h: number) => formatNumber(h, lang, { minimumIntegerDigits: 2, useGrouping: false }),
    [lang],
  );
  const data = movement.data;
  const insights = useMemo(() => (data ? movementInsights(data) : null), [data]);

  const mapCells = useMemo<MapCell[]>(() => {
    const rows = data?.cells ?? [];
    let max = 0;
    const weights = rows.map((c) => {
      const w = c.movingSec + c.stoppedSec || c.points;
      max = Math.max(max, w);
      return w;
    });
    return rows.map((c, i) => {
      const share = activityShare(weights[i] ?? 0, max);
      return {
        south: c.south,
        west: c.west,
        north: c.north,
        east: c.east,
        color: activityColor(share),
        opacity: 0.45 + share * 0.4,
        tip: [
          t('spatial.movement.drivingHours', { n: n(hoursOf(c.movingSec), 1) }),
          t('spatial.movement.stopHours', { n: n(hoursOf(c.stoppedSec), 1) }),
          c.vehicles > 0 ? t('spatial.movement.stopVehicles', { n: n(c.vehicles) }) : '',
        ]
          .filter(Boolean)
          .join('\n'),
      };
    });
  }, [data, t, n]);
  const stopPoints = useMemo<MapPoint[]>(
    () =>
      (data?.stopHotspots ?? []).map((c, i) => ({
        lat: c.lat,
        lng: c.lng,
        color: '#F79009',
        label: String(i + 1),
        tip: t('spatial.movement.stopTip', {
          rank: n(i + 1),
          hours: n(hoursOf(c.stoppedSec), 1),
          vehicles: n(c.vehicles),
        }),
      })),
    [data, t, n],
  );

  const hourOption = useMemo<EChartsOption | null>(() => {
    if (!insights) return null;
    return {
      tooltip: { trigger: 'axis' },
      legend: { bottom: 0, itemWidth: 10, itemHeight: 10 },
      grid: { containLabel: true, left: 8, right: 12, top: 12, bottom: 32 },
      xAxis: { type: 'category', data: Array.from({ length: 24 }, (_, h) => pad2(h)) },
      yAxis: { type: 'value', name: t('spatial.movement.hoursUnit') },
      series: [
        {
          name: t('spatial.movement.driving'),
          type: 'bar',
          stack: 'h',
          itemStyle: { color: chart.moving, borderRadius: [0, 0, 0, 0] },
          data: insights.byHour.moving.map((s) => hoursOf(s)),
        },
        {
          name: t('spatial.movement.stopped'),
          type: 'bar',
          stack: 'h',
          itemStyle: { color: chart.stopped, borderRadius: [4, 4, 0, 0] },
          data: insights.byHour.stopped.map((s) => hoursOf(s)),
        },
      ],
    };
  }, [insights, t, pad2]);

  const weekOption = useMemo<EChartsOption | null>(() => {
    if (!insights) return null;
    const order = weekOrder(lang);
    const cells: Array<[number, number, number]> = [];
    let max = 0;
    order.forEach((dow, y) => {
      for (let h = 0; h < 24; h++) {
        const v = hoursOf(insights.matrix[dow][h]);
        max = Math.max(max, v);
        cells.push([h, y, v]);
      }
    });
    return {
      tooltip: {
        formatter: (p: unknown) => {
          const v = (p as { value: [number, number, number] }).value;
          return `${weekdayName(order[v[1]], lang)} ${pad2(v[0])}:00 — ${t('spatial.movement.drivingHours', { n: n(v[2], 1) })}`;
        },
      },
      grid: { containLabel: true, left: 8, right: 12, top: 8, bottom: 48 },
      xAxis: {
        type: 'category',
        data: Array.from({ length: 24 }, (_, h) => pad2(h)),
        splitArea: { show: true },
      },
      yAxis: {
        type: 'category',
        data: order.map((d) => weekdayName(d, lang)),
        splitArea: { show: true },
      },
      visualMap: {
        min: 0,
        max: max || 1,
        calculable: false,
        orient: 'horizontal',
        left: 'center',
        bottom: 0,
        itemHeight: 120,
        inRange: { color: ['#EEF2FF', '#7A8CFF', '#465FFB', '#1E2A99'] },
      },
      series: [{ type: 'heatmap', data: cells, emphasis: { itemStyle: { borderColor: '#000' } } }],
    };
  }, [insights, lang, t, n, pad2]);

  if (movement.isError) {
    return (
      <Card>
        <ErrorState error={movement.error} onRetry={() => void movement.refetch()} />
      </Card>
    );
  }

  const loading = movement.isLoading;
  const empty = !loading && (data?.cells.length ?? 0) === 0;
  const cellKm2 = ((data?.cellMeters ?? filters.cell) / 1000) ** 2;

  const findings: string[] = [];
  if (data && insights && !empty) {
    findings.push(
      t('spatial.movement.find.area', {
        area: n(data.area.areaKm2, 1),
        share: n(Math.round(data.area.coverage * 100)),
      }),
    );
    if (insights.peakHour !== null) {
      findings.push(
        t('spatial.movement.find.peak', {
          from: pad2(insights.peakHour),
          to: pad2((insights.peakHour + 1) % 24),
        }),
      );
    }
    if (insights.quietHour !== null && insights.quietHour !== insights.peakHour) {
      findings.push(t('spatial.movement.find.quiet', { hour: pad2(insights.quietHour) }));
    }
    if (insights.busiestDay !== null) {
      findings.push(
        t('spatial.movement.find.day', { day: weekdayName(insights.busiestDay, lang) }),
      );
    }
    findings.push(
      t(
        insights.utilization < 35
          ? 'spatial.movement.find.utilLow'
          : insights.utilization > 70
            ? 'spatial.movement.find.utilHigh'
            : 'spatial.movement.find.utilMid',
        { n: n(insights.utilization) },
      ),
    );
    if (data.stopHotspots[0]) {
      findings.push(
        t('spatial.movement.find.stop', { hours: n(hoursOf(data.stopHotspots[0].stoppedSec), 1) }),
      );
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          icon={MapPinned}
          tone="brand"
          loading={loading}
          label={t('spatial.movement.kpi.area')}
          value={n(data?.area.areaKm2 ?? 0, 1)}
          unit={t('spatial.movement.unit.km2')}
          hint={t('spatial.movement.kpi.areaHint')}
        />
        <StatCard
          icon={Truck}
          tone="info"
          loading={loading}
          label={t('spatial.movement.kpi.vehicles')}
          value={n(insights?.activeVehicles ?? 0)}
          hint={t('spatial.movement.kpi.vehiclesHint', { n: n(data?.vehicles.length ?? 0) })}
        />
        <StatCard
          icon={Route}
          tone="success"
          loading={loading}
          label={t('spatial.movement.kpi.distance')}
          value={n(insights?.totalDistanceKm ?? 0)}
          unit={t('spatial.movement.unit.km')}
          hint={t('spatial.movement.kpi.distanceHint', {
            n: n(hoursOf(insights?.totalMovingSec ?? 0), 1),
          })}
        />
        <StatCard
          icon={Gauge}
          tone="warning"
          loading={loading}
          label={t('spatial.movement.kpi.utilization')}
          value={`${n(insights?.utilization ?? 0)}%`}
          hint={t('spatial.movement.kpi.utilizationHint', {
            n: n(hoursOf(insights?.totalStoppedSec ?? 0), 1),
          })}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card flush className="relative h-[360px] overflow-hidden sm:h-[480px] lg:h-[560px]">
          <AnalyticsMap
            cells={mapCells}
            hull={data?.area.hull ?? []}
            points={stopPoints}
            fitKey={`${filters.preset}|${filters.vehicleId ?? ''}|${filters.cell}|${data?.cells.length ?? 0}`}
            focus={focus}
          />
          <div className="pointer-events-none absolute bottom-2 start-2 flex max-w-[calc(100%-4rem)] flex-wrap gap-x-3 gap-y-1 rounded-xl bg-white/90 px-3 py-2 text-[0.7rem] font-semibold text-gray-700 shadow-md dark:bg-graydark-300/90 dark:text-graydark-800">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-0 w-4 border-t-2 border-dashed border-[#465FFB]" />
              {t('spatial.movement.legend.area')}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="size-3 rounded-sm bg-gradient-to-r from-[#06B6D4] via-[#FDB022] to-[#F04438]" />
              {t('spatial.movement.legend.heat')}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="size-3 rounded-full border-2 border-white bg-[#F79009]" />
              {t('spatial.movement.legend.stops')}
            </span>
          </div>
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-white/60 dark:bg-graydark-200/60">
              <Skeleton className="h-6 w-40" />
            </div>
          )}
          {empty && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-white/70 p-6 dark:bg-graydark-200/70">
              <EmptyState
                icon={<Route size={28} />}
                title={t('spatial.movement.emptyTitle')}
                description={t('spatial.movement.emptyHelp')}
              />
            </div>
          )}
        </Card>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader
              title={t('spatial.movement.findingsTitle')}
              icon={<Lightbulb size={17} />}
            />
            {loading ? (
              <p className="text-sm text-gray-500">{t('common.loading')}</p>
            ) : findings.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-graydark-600">
                {t('spatial.movement.emptyHelp')}
              </p>
            ) : (
              <ul className="flex list-disc flex-col gap-1.5 ps-5 text-sm leading-6 text-gray-700 dark:text-graydark-700">
                {findings.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <CardHeader title={t('spatial.movement.stopsTitle')} />
            {(data?.stopHotspots.length ?? 0) === 0 ? (
              <p className="text-sm text-gray-500 dark:text-graydark-600">
                {loading ? t('common.loading') : t('spatial.movement.noStops')}
              </p>
            ) : (
              <ol className="flex flex-col gap-1.5">
                {data?.stopHotspots.slice(0, 6).map((c, i) => (
                  <li key={`${c.lat}:${c.lng}`}>
                    <button
                      type="button"
                      onClick={() => setFocus({ lat: c.lat, lng: c.lng, nonce: Date.now() })}
                      className="flex w-full cursor-pointer items-center gap-3 rounded-xl border border-gray-200 bg-transparent px-3 py-2 text-start transition-colors hover:bg-gray-50 dark:border-white/10 dark:hover:bg-white/5"
                    >
                      <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-warning-500 text-xs font-bold text-white">
                        {n(i + 1)}
                      </span>
                      <span className="min-w-0 flex-1 text-sm">
                        <span className="block truncate font-semibold text-gray-800 dark:text-white">
                          {t('spatial.movement.stopHours', { n: n(hoursOf(c.stoppedSec), 1) })}
                        </span>
                        <span className="block truncate text-xs text-gray-500 dark:text-graydark-600">
                          {t('spatial.movement.stopVehicles', { n: n(c.vehicles) })}
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

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title={t('spatial.movement.byHourTitle')} />
          {hourOption && !empty ? (
            <EChart option={hourOption} height={260} />
          ) : (
            <Skeleton className="h-[260px] w-full" />
          )}
        </Card>
        <Card>
          <CardHeader title={t('spatial.movement.weekTitle')} />
          {weekOption && !empty ? (
            <EChart option={weekOption} height={300} />
          ) : (
            <Skeleton className="h-[300px] w-full" />
          )}
        </Card>
      </div>

      <Card flush>
        <div className="p-4 pb-0 sm:p-5 sm:pb-0">
          <CardHeader title={t('spatial.movement.vehiclesTitle')} />
        </div>
        <div className="fv-scroll overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-xs text-gray-500 dark:border-white/10 dark:text-graydark-600">
                {(
                  [
                    'vehicle',
                    'distance',
                    'driving',
                    'stopped',
                    'utilization',
                    'avgSpeed',
                    'maxSpeed',
                    'days',
                    'range',
                  ] as const
                ).map((k) => (
                  <th key={k} className="px-4 py-2.5 text-start font-semibold whitespace-nowrap">
                    {t(`spatial.movement.col.${k}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(data?.vehicles ?? []).map((v) => {
                const total = v.movingSec + v.stoppedSec;
                const util = total > 0 ? Math.round((v.movingSec / total) * 100) : 0;
                return (
                  <tr
                    key={v.vehicleId}
                    className="border-b border-gray-100 last:border-0 dark:border-white/5"
                  >
                    <td className="max-w-[220px] truncate px-4 py-2.5 font-semibold text-gray-800 dark:text-white">
                      {captionOf(v.vehicleId) || v.vehicleId.slice(0, 8)}
                    </td>
                    <td className="px-4 py-2.5 tabular-nums">
                      {t('spatial.movement.km', { n: n(v.distanceKm, 1) })}
                    </td>
                    <td className="px-4 py-2.5 tabular-nums">
                      {t('spatial.movement.h', { n: n(hoursOf(v.movingSec), 1) })}
                    </td>
                    <td className="px-4 py-2.5 tabular-nums">
                      {t('spatial.movement.h', { n: n(hoursOf(v.stoppedSec), 1) })}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-16 overflow-hidden rounded-full bg-gray-100 dark:bg-white/10">
                          <div
                            className="h-full rounded-full bg-success-500"
                            style={{ width: `${util}%` }}
                          />
                        </div>
                        <span className="tabular-nums">{n(util)}%</span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 tabular-nums">
                      {v.avgMovingKph !== null
                        ? t('spatial.movement.kph', { n: n(v.avgMovingKph) })
                        : '—'}
                    </td>
                    <td className="px-4 py-2.5 tabular-nums">
                      {t('spatial.movement.kph', { n: n(v.maxKph) })}
                    </td>
                    <td className="px-4 py-2.5 tabular-nums">{n(v.activeDays)}</td>
                    <td className="px-4 py-2.5 tabular-nums">
                      {t('spatial.movement.km2', { n: n(v.cells * cellKm2, 1) })}
                    </td>
                  </tr>
                );
              })}
              {!loading && (data?.vehicles.length ?? 0) === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-6 text-center text-gray-500">
                    {t('spatial.movement.emptyHelp')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
