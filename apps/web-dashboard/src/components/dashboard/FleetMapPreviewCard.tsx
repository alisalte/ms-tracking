import { MapPin } from 'lucide-react';
import { Map as MaplibreMap, Marker as MaplibreMarker, Popup as MaplibrePopup } from 'maplibre-gl';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { useMapVehicles } from '@/api/fleet.api';
import { Skeleton } from '@/components/tailwind-ui';
import { PRESENCE_COLORS, markerDataUrl, vehicleColor } from '@/lib/map-markers';
import type { VehiclePresence } from '@/types/fleet.types';

import { DashboardCard } from './DashboardCard';

/** Legend entries (§18 presence) — never rely on color alone; paired with labels. */
const LEGEND: Array<{ presence: VehiclePresence; key: string }> = [
  { presence: 'ONLINE', key: 'dashboard.map.online' },
  { presence: 'STALE', key: 'dashboard.map.stale' },
  { presence: 'OFFLINE', key: 'dashboard.map.offline' },
  { presence: 'UNKNOWN', key: 'dashboard.map.unknown' },
];

/**
 * FleetMapPreviewCard — the dashboard mini-map (Phase 4, TailAdmin chrome).
 *
 * Identical MapLibre logic to the previous FleetMapPreview: free OSM raster
 * tiles, vehicle markers tinted by the REAL connection presence (§18), popup
 * with label/presence/speed, and a glass legend overlay. Clustering lives on
 * the full Live Tracking map (supercluster) — this preview stays marker-only
 * by design. Links to /map.
 */
export function FleetMapPreviewCard() {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MaplibreMap | null>(null);
  const markersRef = useRef<MaplibreMarker[]>([]);
  const { data, isLoading, isError, refetch } = useMapVehicles();
  const vehicles = data ?? [];

  // Initialize the map once.
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new MaplibreMap({
      container: containerRef.current,
      style: {
        version: 8,
        sources: {
          osm: {
            type: 'raster',
            tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
            tileSize: 256,
            attribution: '© OpenStreetMap contributors',
          },
        },
        layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
      },
      center: [51.338, 35.719],
      zoom: 11,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
    });
    mapRef.current = map;

    return () => {
      for (const m of markersRef.current) m.remove();
      markersRef.current = [];
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Sync markers when vehicles arrive.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || vehicles.length === 0) return;

    const apply = () => {
      for (const m of markersRef.current) m.remove();
      markersRef.current = vehicles.map((v) => {
        const el = document.createElement('img');
        el.src = markerDataUrl(vehicleColor(v));
        el.alt = v.label;
        el.style.width = '20px';
        el.style.height = '20px';
        el.style.cursor = 'pointer';
        const presence = v.presence ?? 'UNKNOWN';
        const marker = new MaplibreMarker({ element: el, anchor: 'center' })
          .setLngLat([v.lng, v.lat])
          .setPopup(
            new MaplibrePopup({ offset: 12 }).setHTML(
              `<b>${v.label}</b><br/>${t(`map.presence.${presence}`)} · ${v.speed} km/h`,
            ),
          );
        marker.addTo(map);
        return marker;
      });
    };

    if (map.loaded()) apply();
    else map.once('load', apply);
  }, [vehicles, t]);

  return (
    <DashboardCard
      titleKey="dashboard.widgets.mapPreview"
      icon={MapPin}
      flush
      action={
        <Link
          to="/map"
          className="text-xs font-semibold text-brand-600 no-underline hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300"
        >
          {t('dashboard.widgets.openMap')} →
        </Link>
      }
    >
      <div className="relative h-[220px] w-full overflow-hidden rounded-lg">
        {/* The map container is ALWAYS mounted — loading/error/empty render
         * as light overlays on top of the tiles, never as body replacements
         * (the map should stay visible even with no devices reporting). */}
        <div ref={containerRef} className="h-full w-full" />
        {/* Legend overlay (§0.7: never rely on color alone — pair with label). */}
        <div className="absolute bottom-2 start-2 flex items-center gap-3 rounded-lg border border-white/60 bg-white/75 px-2.5 py-1 shadow-sm backdrop-blur-md">
          {LEGEND.map(({ presence, key }) => (
            <span key={presence} className="flex items-center gap-1.5">
              <span
                aria-hidden
                className="size-2 rounded-full"
                style={{ backgroundColor: PRESENCE_COLORS[presence] }}
              />
              <span className="text-[0.7rem] text-gray-600 dark:text-graydark-600">{t(key)}</span>
            </span>
          ))}
        </div>
        {isLoading && !isError && <Skeleton className="absolute inset-0" />}
        {!isLoading && isError && (
          <div
            data-testid="map-preview-error"
            className="absolute inset-0 z-10 flex items-center justify-center bg-white/70 backdrop-blur-sm dark:bg-graydark-800/70"
          >
            <button
              type="button"
              onClick={() => void refetch()}
              className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 shadow-sm hover:bg-gray-50 dark:border-white/10 dark:bg-graydark-300 dark:text-graydark-800"
            >
              {t('dashboard.map.retry')}
            </button>
          </div>
        )}
        {!isLoading && !isError && vehicles.length === 0 && (
          <div
            data-testid="map-preview-empty"
            className="absolute inset-0 z-10 flex items-center justify-center"
          >
            <span className="rounded-full border border-gray-200 bg-white/90 px-3 py-1 text-xs font-medium text-gray-500 shadow-sm dark:border-white/10 dark:bg-graydark-300/90 dark:text-graydark-700">
              {t('map.emptyTitle')}
            </span>
          </div>
        )}
      </div>
    </DashboardCard>
  );
}
