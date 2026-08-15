import { Box, Card, CardContent, Stack, Typography } from '@mui/material';
import { Clock, Fuel, Gauge, MapPin, PauseCircle, Timer } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { Trip } from '@/types/fleet.types';

interface TripSummaryProps {
  trip: Trip;
}

/**
 * TripSummary — the at-a-glance metric tiles for a trip.
 *
 * Distance, duration, max/avg speed, stop count, idle time, and fuel — the
 * numbers a dispatcher scans first. Each tile pairs an icon with the label
 * (§0.7) and uses tabular-nums so live values don't jitter.
 */
export function TripSummary({ trip }: TripSummaryProps) {
  const { t } = useTranslation();

  const tiles: Array<{ icon: LucideIcon; label: string; value: string; color?: string }> = [
    {
      icon: MapPin,
      label: t('trips.summary.distance'),
      value: `${trip.distanceKm.toLocaleString('en-US')} km`,
    },
    { icon: Clock, label: t('trips.summary.duration'), value: formatDuration(trip.durationMin) },
    { icon: Gauge, label: t('trips.summary.maxSpeed'), value: `${trip.maxSpeed} km/h` },
    { icon: Timer, label: t('trips.summary.avgSpeed'), value: `${trip.avgSpeed} km/h` },
    { icon: MapPin, label: t('trips.summary.stops'), value: String(trip.stopCount) },
    {
      icon: PauseCircle,
      label: t('trips.summary.idleTime'),
      value: trip.idleMin === undefined ? '—' : formatDuration(trip.idleMin),
    },
    ...(trip.fuelL !== undefined
      ? [{ icon: Fuel, label: t('trips.summary.fuel'), value: `${trip.fuelL} L` }]
      : []),
  ];

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: 'repeat(3, 1fr)', md: 'repeat(4, 1fr)' },
        gap: 1.5,
      }}
    >
      {tiles.map((tile) => {
        const Icon = tile.icon;
        return (
          <Card key={tile.label} variant="outlined">
            <CardContent
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1.5,
                p: 1.5,
                '&:last-child': { pb: 1.5 },
              }}
            >
              <Icon size={18} color="var(--mui-palette-text-secondary)" />
              <Stack>
                <Typography variant="caption" color="text.secondary">
                  {tile.label}
                </Typography>
                <Typography
                  variant="subtitle1"
                  fontWeight={700}
                  sx={{ fontVariantNumeric: 'tabular-nums' }}
                >
                  {tile.value}
                </Typography>
              </Stack>
            </CardContent>
          </Card>
        );
      })}
    </Box>
  );
}

/** Format minutes as "1h 23m" / "45m". */
function formatDuration(min: number): string {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}
