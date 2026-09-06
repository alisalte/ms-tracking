import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { useMapMarkerStyle } from '@/hooks/useMapMarkerStyle';
import { paintVehicleMarker, vehicleColor } from '@/lib/map-markers';
import type { MapVehicle } from '@/types/fleet.types';

const LEGEND: Array<{
  state: MapVehicle['state'];
  presence?: MapVehicle['presence'];
  key: string;
}> = [
  { state: 'driving', presence: 'ONLINE', key: 'map.states.driving' },
  { state: 'idle', presence: 'ONLINE', key: 'map.states.idle' },
  { state: 'overspeed', presence: 'ONLINE', key: 'map.states.overspeed' },
  { state: 'stopped', presence: 'ONLINE', key: 'map.states.stopped' },
  { state: 'offline', presence: 'OFFLINE', key: 'map.states.offline' },
];

/**
 * Live-map color key — paints the same marker chrome (vehicle body or nav dart)
 * used on the fleet, one per movement state, so operators can read status hues.
 */
export function MapStatusLegend() {
  const { t } = useTranslation();
  const [markerStyle] = useMapMarkerStyle();
  const cellsRef = useRef<Array<HTMLDivElement | null>>([]);

  useEffect(() => {
    LEGEND.forEach((row, i) => {
      const el = cellsRef.current[i];
      if (!el) return;
      paintVehicleMarker(el, 'car', vehicleColor({ state: row.state, presence: row.presence }), {
        heading: 25,
        id: `legend-${row.state}`,
        style: markerStyle,
      });
    });
  }, [markerStyle]);

  return (
    <div
      data-testid="map-status-legend"
      className="pointer-events-none absolute top-16 start-3 z-20 flex flex-col gap-1 rounded-xl border border-gray-200 bg-white/90 px-2 py-1.5 shadow-lg backdrop-blur-md md:start-[320px] dark:border-white/10 dark:bg-graydark-300/90"
    >
      {LEGEND.map((row, i) => (
        <div key={row.state} className="flex items-center gap-1.5">
          <div
            ref={(node) => {
              cellsRef.current[i] = node;
            }}
            className="fv-vehicle-marker pointer-events-none"
            style={{ width: 28, height: 28 }}
            aria-hidden
          />
          <span className="text-[11px] font-medium text-gray-600 dark:text-graydark-700">
            {t(row.key)}
          </span>
        </div>
      ))}
    </div>
  );
}
