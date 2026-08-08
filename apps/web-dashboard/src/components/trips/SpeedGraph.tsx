import { Box, Skeleton, Stack, Typography } from '@mui/material';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { status } from '@/theme/palette';
import type { TripWaypoint } from '@/types/fleet.types';

interface SpeedGraphProps {
  /** Ordered position samples; the chart plots each one's speed. */
  waypoints: TripWaypoint[];
  /** Speed limit (km/h) — a dashed reference line. */
  speedLimitKmh: number;
  /** Current replay index — the playhead the chart highlights. */
  index: number;
  loading?: boolean;
}

/** HH:MM label for a waypoint timestamp. */
function timeLabel(ts: string): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * SpeedGraph — speed-over-time line chart for a trip.
 *
 * Plots `waypoint.speed` across the trip with a dashed reference line at the
 * speed limit, overspeed events as reference dots, and a highlighted playhead
 * that follows the replay index. The custom tooltip shows speed + time.
 */
export function SpeedGraph({ waypoints, speedLimitKmh, index, loading = false }: SpeedGraphProps) {
  const data = waypoints.map((w, i) => ({ i, speed: w.speed, label: timeLabel(w.ts) }));

  return (
    <Box sx={{ width: '100%', height: 240 }}>
      {loading || waypoints.length === 0 ? (
        <Skeleton variant="rounded" sx={{ width: '100%', height: '100%' }} />
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: -12 }}>
            <CartesianGrid
              strokeDasharray="3 3"
              vertical={false}
              stroke="var(--mui-palette-divider)"
            />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11, fill: 'var(--mui-palette-text-secondary)' }}
              tickLine={false}
              axisLine={false}
              interval={Math.max(0, Math.floor(waypoints.length / 6) - 1)}
            />
            <YAxis
              tick={{ fontSize: 11, fill: 'var(--mui-palette-text-secondary)' }}
              tickLine={false}
              axisLine={false}
              width={40}
              unit=""
            />
            <Tooltip
              content={({ active, payload }) =>
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
                      {payload[0]?.payload.label}
                    </Typography>
                    <Stack direction="row" alignItems="center" gap={0.5} sx={{ mt: 0.25 }}>
                      <Box
                        component="span"
                        sx={{
                          width: 8,
                          height: 8,
                          borderRadius: '50%',
                          backgroundColor: status.blue,
                        }}
                      />
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ fontVariantNumeric: 'tabular-nums' }}
                      >
                        {payload[0]?.value} km/h
                      </Typography>
                    </Stack>
                  </Box>
                ) : null
              }
            />
            <ReferenceLine
              y={speedLimitKmh}
              stroke={status.red}
              strokeDasharray="4 4"
              label={{
                value: `${speedLimitKmh}`,
                position: 'insideTopRight',
                fontSize: 10,
                fill: status.red,
              }}
            />
            <Line
              type="monotone"
              dataKey="speed"
              stroke={status.blue}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
              // Highlight the current replay point with a larger green dot.
              activeDot={{
                r: 5,
                fill: status.green,
                stroke: '#FFFFFF',
                strokeWidth: 2,
                key: `dot-${index}`,
              }}
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </Box>
  );
}
