import { Box, Skeleton, Stack, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import type { EChartsOption } from 'echarts';
import { Activity } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useFleetActivity } from '@/api/fleet.api';
import { status } from '@/theme/palette';

import { EChart } from './EChart';
import { WidgetCard } from './WidgetCard';

/** Time-range selector options (UI_UX_Design.md §1.5). */
const RANGES = ['today', '7d', '30d'] as const;
type Range = (typeof RANGES)[number];

/** Localized hour formatter for the x-axis. */
function formatHour(h: number) {
  return `${String(h).padStart(2, '0')}:00`;
}

/** Gradient stops definition keyed by series key (avoids id clashes). */
const SERIES = [
  { key: 'driving', color: status.green, labelKey: 'dashboard.states.driving' },
  { key: 'idle', color: status.amber, labelKey: 'dashboard.states.idle' },
  { key: 'stopped', color: status.slate, labelKey: 'dashboard.states.stopped' },
] as const;

/**
 * FleetActivityChart — 24h stacked-area chart of fleet activity (ECharts).
 *
 * UI_UX_Design.md §1.4: driving / idle / stopped stacked areas with a rich
 * crosshair tooltip, a Today / 7d / 30d selector in the header, and a legend
 * that doubles as a category key. Colors come from the semantic status tokens
 * — green for driving (active), amber for idle, slate for stopped — so the
 * chart shares meaning with the rest of the dashboard.
 */
export function FleetActivityChart() {
  const { t } = useTranslation();
  const [range, setRange] = useState<Range>('today');
  const { data, isLoading } = useFleetActivity(range);

  const option = useMemo(() => {
    if (!data) return null;
    const hours = data.map((b) => b.hour);
    return {
      legend: { show: false },
      tooltip: {
        trigger: 'axis',
        axisPointer: {
          type: 'cross',
          label: { formatter: (p: { value: number }) => formatHour(Number(p.value)) },
        },
      },
      grid: { left: 8, right: 16, top: 16, bottom: 28, containLabel: true },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: hours,
        axisLabel: {
          formatter: (h: string) => formatHour(Number(h)),
          interval: 3,
          hideOverlap: true,
        },
      },
      yAxis: { type: 'value', minInterval: 1 },
      series: SERIES.map((s, idx) => ({
        name: t(s.labelKey),
        type: 'line',
        stack: 'activity',
        smooth: true,
        symbol: 'circle',
        symbolSize: 0,
        showSymbol: false,
        emphasis: { focus: 'series' },
        lineStyle: { width: 1.5 },
        // Stacked area: only the top stack should be filled to its boundary;
        // ECharts fills the cumulative stack area, so a translucent gradient
        // per series reads cleanly.
        areaStyle: {
          opacity: 0.45,
          color: {
            type: 'linear',
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: `${s.color}99` },
              { offset: 1, color: `${s.color}14` },
            ],
          },
        },
        itemStyle: { color: s.color },
        // ensure stack order: driving bottom, stopped top
        z: SERIES.length - idx,
        data: data.map((b) => (b as unknown as Record<string, number>)[s.key]),
      })),
    } as EChartsOption;
  }, [data, t]);

  return (
    <WidgetCard
      titleKey="dashboard.widgets.activity"
      icon={Activity}
      live={range === 'today'}
      loading={isLoading}
      action={
        <ToggleButtonGroup
          exclusive
          size="small"
          value={range}
          onChange={(_, next: Range | null) => next && setRange(next)}
          aria-label={t('dashboard.widgets.activityRange')}
        >
          {RANGES.map((r) => (
            <ToggleButton
              key={r}
              value={r}
              sx={{
                px: 1.25,
                py: 0.25,
                fontSize: '0.75rem',
                textTransform: 'none',
                lineHeight: 1.4,
              }}
            >
              {t(`dashboard.range.${r}`)}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      }
    >
      <Box sx={{ width: '100%', height: 260 }}>
        {isLoading || !option ? (
          <Skeleton variant="rounded" sx={{ width: '100%', height: '100%' }} />
        ) : (
          <EChart option={option} height={260} />
        )}
      </Box>

      {/* Legend doubles as a filter (§1.4) — color + label, no interactivity yet. */}
      <Stack direction="row" gap={2} sx={{ mt: 1, flexWrap: 'wrap' }}>
        {SERIES.map((s) => (
          <Stack key={s.key} direction="row" alignItems="center" gap={0.5}>
            <Box
              component="span"
              sx={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: s.color }}
            />
            <Typography variant="caption" color="text.secondary">
              {t(s.labelKey)}
            </Typography>
          </Stack>
        ))}
      </Stack>
    </WidgetCard>
  );
}
