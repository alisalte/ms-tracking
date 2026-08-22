import { Clock, Fuel, Gauge, MapPin, PauseCircle, Timer } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Card } from '@/components/tailwind-ui';
import type { Trip } from '@/types/fleet.types';

interface TripSummaryProps {
  trip: Trip;
}

/**
 * TripSummary — the at-a-glance metric tiles for a trip (TailAdmin port).
 *
 * Distance, duration, max/avg speed, stop count, idle time, and fuel — the
 * numbers a dispatcher scans first. Each tile pairs an icon with the label
 * (§0.7) and uses tabular-nums so live values don't jitter.
 */
export function TripSummary({ trip }: TripSummaryProps) {
  const { t } = useTranslation();

  const tiles: Array<{ icon: LucideIcon; label: string; value: string }> = [
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
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
      {tiles.map((tile) => {
        const Icon = tile.icon;
        return (
          <Card key={tile.label} className="flex items-center gap-3 p-3">
            <Icon size={18} aria-hidden className="shrink-0 text-gray-500 dark:text-graydark-600" />
            <div className="min-w-0">
              <p className="text-xs text-gray-500 dark:text-graydark-600">{tile.label}</p>
              <p className="text-base font-bold tabular-nums text-gray-900 dark:text-white">
                {tile.value}
              </p>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

/** Format minutes as "1h 23m" / "45m". */
function formatDuration(min: number): string {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}
