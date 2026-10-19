/**
 * SpatialAnalyticsPage — "Location analytics" (`/analytics`).
 *
 * Two map-first views over the position history (gps-engine analytics API):
 * - coverage: GPS signal heatmap — where the project has good, weak, or no
 *   satellite signal (fixes + silent gaps + GPS-loss alarms).
 * - movement: the project working area, activity heatmap, stop hotspots,
 *   time-of-day / weekday patterns and a per-vehicle breakdown.
 *
 * View, window, vehicle and grid size sync to the URL (`?tab=&range=&vehicle=&cell=`)
 * so a finding can be shared as a link.
 */
import { Footprints, SatelliteDish } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

import {
  ANALYTICS_PRESETS,
  type AnalyticsFilters,
  type AnalyticsPreset,
} from '@/api/analytics.api';
import { useVehicles } from '@/api/asset.api';
import { GpsCoverageView } from '@/components/analytics/GpsCoverageView';
import { MovementPatternsView } from '@/components/analytics/MovementPatternsView';
import { PageHeader, SegmentedControl, Select, Tabs } from '@/components/tailwind-ui';
import { formatNumber } from '@/lib/format-number';
import { formatVehicleLabel } from '@/lib/vehicle-label';

type View = 'coverage' | 'movement';
const CELL_SIZES = [100, 250, 500, 1000] as const;

export function SpatialAnalyticsPage() {
  const { t, i18n } = useTranslation();
  const [params, setParams] = useSearchParams();
  const { data: vehicles } = useVehicles();

  const view: View = params.get('tab') === 'movement' ? 'movement' : 'coverage';
  const rawRange = params.get('range');
  const preset: AnalyticsPreset = (ANALYTICS_PRESETS as readonly string[]).includes(rawRange ?? '')
    ? (rawRange as AnalyticsPreset)
    : '7d';
  const rawCell = Number(params.get('cell'));
  const cell = (CELL_SIZES as readonly number[]).includes(rawCell) ? rawCell : 250;
  const vehicleId = params.get('vehicle') || undefined;

  const filters = useMemo<AnalyticsFilters>(
    () => ({ preset, cell, vehicleId }),
    [preset, cell, vehicleId],
  );

  const update = (key: string, value: string | null) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );

  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-4">
      <PageHeader title={t('spatial.title')} description={t('spatial.subtitle')} />

      <Tabs
        aria-label={t('spatial.title')}
        value={view}
        onChange={(v) => update('tab', v)}
        tabs={[
          {
            value: 'coverage',
            label: t('spatial.tabs.coverage'),
            icon: <SatelliteDish size={15} />,
          },
          { value: 'movement', label: t('spatial.tabs.movement'), icon: <Footprints size={15} /> },
        ]}
      />

      <div className="flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:items-end">
        <SegmentedControl
          aria-label={t('spatial.filters.range')}
          value={preset}
          onChange={(v) => update('range', v)}
          options={ANALYTICS_PRESETS.map((p) => ({ value: p, label: t(`spatial.range.${p}`) }))}
        />
        <div className="grid grid-cols-2 gap-2.5 sm:flex">
          <Select
            aria-label={t('spatial.filters.vehicle')}
            wrapperClassName="sm:w-56"
            value={vehicleId ?? ''}
            onChange={(e) => update('vehicle', e.target.value || null)}
            options={[
              { value: '', label: t('spatial.filters.allVehicles') },
              ...(vehicles ?? []).map((v) => ({ value: v.id, label: formatVehicleLabel(v) })),
            ]}
          />
          <Select
            aria-label={t('spatial.filters.cell')}
            wrapperClassName="sm:w-40"
            value={String(cell)}
            onChange={(e) => update('cell', e.target.value)}
            options={CELL_SIZES.map((c) => ({
              value: String(c),
              label: t('spatial.filters.cellOption', { n: formatNumber(c, i18n.language) }),
            }))}
          />
        </div>
      </div>

      {view === 'coverage' ? (
        <GpsCoverageView filters={filters} />
      ) : (
        <MovementPatternsView filters={filters} />
      )}
    </div>
  );
}
