import { Box, Skeleton, Stack, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import { Activity } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { useFleetActivity } from '@/api/fleet.api';
import { status } from '@/theme/palette';

import { WidgetCard } from './WidgetCard';

/** Time-range selector options (UI_UX_Design.md §1.5). */
const RANGES = ['today', '7d', '30d'] as const;
type Range = (typeof RANGES)[number];

/** Localized hour formatter for the x-axis. */
function formatHour(h: number) {
  return `${String(h).padStart(2, '0')}:00`;
}

/**
 * FleetActivityChart — 24h stacked-area chart of fleet activity.
 *
 * UI_UX_Design.md §1.4: driving / idle / stopped stacked areas, hover shows
 * counts per hour, the legend doubles as a filter, and a Today / 7d / 30d
 * selector sits in the header. The "Live" badge is only shown on Today.
 *
 * Colors come from the semantic status tokens — green for driving (active),
 * amber for idle (approaching), slate for stopped (neutral) — so the chart
 * shares meaning with the rest of the dashboard.
 */
export function FleetActivityChart() {
  const { t } = useTranslation();
  const [range, setRange] = useState<Range>('today');
  const { data, isLoading } = useFleetActivity(range);

  const series = [
    { key: 'driving', color: status.green, labelKey: 'dashboard.states.driving' },
    { key: 'idle', color: status.amber, labelKey: 'dashboard.states.idle' },
    { key: 'stopped', color: status.slate, labelKey: 'dashboard.states.stopped' },
  ] as const;

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
        {isLoading || !data ? (
          <Skeleton variant="rounded" sx={{ width: '100%', height: '100%' }} />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: -12 }}>
              <defs>
                {series.map((s) => (
                  <linearGradient key={s.key} id={`activity-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={s.color} stopOpacity={0.5} />
                    <stop offset="95%" stopColor={s.color} stopOpacity={0.05} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid
                strokeDasharray="3 3"
                vertical={false}
                stroke="var(--mui-palette-divider)"
              />
              <XAxis
                dataKey="hour"
                tickFormatter={formatHour}
                tick={{ fontSize: 11, fill: 'var(--mui-palette-text-secondary)' }}
                tickLine={false}
                axisLine={false}
                interval={3}
              />
              <YAxis
                tick={{ fontSize: 11, fill: 'var(--mui-palette-text-secondary)' }}
                tickLine={false}
                axisLine={false}
                width={40}
              />
              <Tooltip
                content={({ active, payload, label }) =>
                  active && payload && payload.length > 0 ? (
                    <Box
                      sx={{
                        backgroundColor: 'background.paper',
                        border: '1px solid',
                        borderColor: 'divider',
                        borderRadius: 1,
                        p: 1,
                        boxShadow: 1,
                      }}
                    >
                      <Typography variant="caption" fontWeight={600}>
                        {formatHour(Number(label))}
                      </Typography>
                      <Stack gap={0.25} sx={{ mt: 0.5 }}>
                        {payload.map((entry) => (
                          <Stack
                            key={String(entry.dataKey)}
                            direction="row"
                            alignItems="center"
                            gap={0.75}
                          >
                            <Box
                              component="span"
                              sx={{
                                width: 8,
                                height: 8,
                                borderRadius: '50%',
                                backgroundColor: entry.color,
                              }}
                            />
                            <Typography
                              variant="caption"
                              color="text.secondary"
                              sx={{ fontVariantNumeric: 'tabular-nums' }}
                            >
                              {entry.value}
                            </Typography>
                          </Stack>
                        ))}
                      </Stack>
                    </Box>
                  ) : null
                }
              />
              {series.map((s) => (
                <Area
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  stackId="activity"
                  stroke={s.color}
                  strokeWidth={1.5}
                  fill={`url(#activity-${s.key})`}
                  isAnimationActive={false}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        )}
      </Box>

      {/* Legend doubles as a filter (§1.4) — color + label, no interactivity yet. */}
      <Stack direction="row" gap={2} sx={{ mt: 1, flexWrap: 'wrap' }}>
        {series.map((s) => (
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
