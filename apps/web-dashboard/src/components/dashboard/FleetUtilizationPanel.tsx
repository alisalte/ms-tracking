import { Box, Skeleton, Stack, Typography } from '@mui/material';
import { GaugeCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts';

import { useFleetUtilization } from '@/api/fleet.api';
import { status } from '@/theme/palette';
import type { VehicleState } from '@/types/fleet.types';

import { WidgetCard } from './WidgetCard';

/** State → semantic color (§0.2): green driving, amber idle, slate stopped/offline. */
const STATE_COLOR: Record<VehicleState, string> = {
  driving: status.green,
  idle: status.amber,
  stopped: status.slate,
  offline: '#94A3B8',
};

/**
 * FleetUtilizationPanel — donut + horizontal bars.
 *
 * UI_UX_Design.md §1.4: a donut with the headline utilization % in the center
 * and horizontal bars showing time-in-state breakdown (driving / idle / stopped
 * / offline).
 */
export function FleetUtilizationPanel() {
  const { t } = useTranslation();
  const { data, isLoading } = useFleetUtilization();

  return (
    <WidgetCard titleKey="dashboard.widgets.utilization" icon={GaugeCircle} loading={isLoading}>
      {isLoading || !data ? (
        <Skeleton variant="rounded" sx={{ width: '100%', height: 220 }} />
      ) : (
        <Stack direction={{ xs: 'column', sm: 'row' }} gap={2} alignItems="center">
          {/* Donut with centered headline % */}
          <Box sx={{ position: 'relative', width: 140, height: 140, flexShrink: 0 }}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data.breakdown}
                  dataKey="percent"
                  nameKey="state"
                  innerRadius={46}
                  outerRadius={68}
                  paddingAngle={2}
                  stroke="none"
                  isAnimationActive={false}
                >
                  {data.breakdown.map((entry) => (
                    <Cell key={entry.state} fill={STATE_COLOR[entry.state]} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <Box
              sx={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                pointerEvents: 'none',
              }}
            >
              <Typography
                variant="h4"
                fontWeight={700}
                sx={{ fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}
              >
                {data.utilization}%
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {t('dashboard.utilization.utilized')}
              </Typography>
            </Box>
          </Box>

          {/* Horizontal bars */}
          <Stack gap={1.25} sx={{ flex: 1, width: '100%', minWidth: 0 }}>
            {data.breakdown.map((entry) => (
              <Box key={entry.state}>
                <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.25 }}>
                  <Typography variant="caption" color="text.secondary">
                    {t(`dashboard.states.${entry.state}`)}
                  </Typography>
                  <Typography
                    variant="caption"
                    fontWeight={600}
                    sx={{ fontVariantNumeric: 'tabular-nums' }}
                  >
                    {entry.percent}%
                  </Typography>
                </Stack>
                <Box
                  sx={{
                    width: '100%',
                    height: 6,
                    borderRadius: 3,
                    backgroundColor: 'action.hover',
                    overflow: 'hidden',
                  }}
                >
                  <Box
                    sx={{
                      width: `${entry.percent}%`,
                      height: '100%',
                      borderRadius: 3,
                      backgroundColor: STATE_COLOR[entry.state],
                    }}
                  />
                </Box>
              </Box>
            ))}
          </Stack>
        </Stack>
      )}
    </WidgetCard>
  );
}
