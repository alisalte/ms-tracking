/**
 * SpeedingSection — the "Speeding details" report tab: pick any vehicle and see
 * every run of stored GPS fixes above the limit (see SpeedingEventsCard).
 */
import { useMemo } from 'react';

import { useVehicles } from '@/api/asset.api';
import type { ReportRange } from '@/api/report.api';
import { SpeedingEventsCard } from '@/components/reports/SpeedingEventsCard';

export function SpeedingSection({ range }: { range: ReportRange }) {
  const vehiclesQ = useVehicles();
  const vehicles = useMemo(
    () =>
      (vehiclesQ.data ?? []).map((v) => ({
        vehicleId: v.id,
        label: v.plate && v.plate !== v.name ? `${v.name} · ${v.plate}` : v.name,
      })),
    [vehiclesQ.data],
  );
  return <SpeedingEventsCard range={range} vehicles={vehicles} />;
}
