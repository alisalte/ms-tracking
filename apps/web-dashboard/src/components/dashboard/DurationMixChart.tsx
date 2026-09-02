import type { ApexOptions } from 'apexcharts';
import { Timer } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useFleetOverview } from '@/api/report.api';
import { hoursFromSec } from '@/lib/hours-from-sec';
import { chart } from '@/theme/palette';

import { ApexChart } from './ApexChart';
import { DashboardCard } from './DashboardCard';

const RANGE = { preset: '7d' } as const;

/**
 * DurationMixChart — moving / idle / parking duration mix (last 7 days).
 *
 * Uses authoritative sums from fleet-overview (KPI definitions: Moving /
 * Idle / Parking duration). Offline duration is intentionally omitted
 * (no offline-period projection — KPI doc).
 */
export function DurationMixChart() {
  const { t } = useTranslation();
  const overview = useFleetOverview(RANGE);
  const o = overview.data;

  const slices = useMemo(() => {
    if (!o) return [] as Array<{ label: string; value: number; color: string }>;
    return [
      {
        label: t('dashboard.charts.movingHours'),
        value: hoursFromSec(o.movingDurationSec ?? 0),
        color: chart.moving,
      },
      {
        label: t('dashboard.charts.idleHours'),
        value: hoursFromSec(o.idleDurationSec ?? 0),
        color: chart.idle,
      },
      {
        label: t('dashboard.charts.parkingHours'),
        value: hoursFromSec(o.parkingDurationSec ?? 0),
        color: chart.parked,
      },
    ].filter((s) => s.value > 0);
  }, [o, t]);

  const empty =
    !overview.isLoading &&
    !overview.isError &&
    slices.length === 0;

  const options = useMemo<ApexOptions>(
    () => ({
      labels: slices.map((s) => s.label),
      colors: slices.map((s) => s.color),
      legend: { position: 'bottom' },
      plotOptions: {
        pie: {
          donut: {
            size: '68%',
            labels: {
              show: true,
              total: {
                show: true,
                label: t('dashboard.charts.totalHours'),
                formatter: () =>
                  slices.reduce((a, b) => a + b.value, 0).toLocaleString(),
              },
            },
          },
        },
      },
      tooltip: {
        y: { formatter: (v: number) => `${v.toLocaleString()} h` },
      },
    }),
    [slices, t],
  );

  return (
    <DashboardCard
      titleKey="dashboard.widgets.durationMix"
      accent="success"
      icon={Timer}
      loading={overview.isLoading && !overview.isError}
      empty={empty}
      emptyKey="reports.charts.empty"
      error={overview.isError ? overview.error : undefined}
      onRetry={() => void overview.refetch()}
      flush
    >
      <div className="w-full px-4 pb-3 sm:px-5">
        <ApexChart type="donut" series={slices.map((s) => s.value)} options={options} height={240} />
      </div>
    </DashboardCard>
  );
}
