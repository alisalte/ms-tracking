import { MapPin } from 'lucide-react';
import { Map as MaplibreMap, Marker as MaplibreMarker, Popup as MaplibrePopup } from 'maplibre-gl';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { useMapVehicles } from '@/api/fleet.api';
import { markerDataUrl, vehicleColor } from '@/lib/map-markers';
import { mapAccents } from '@/theme/palette';

import { WidgetCard } from './WidgetCard';

/**
 * FleetMapPreview — a compact MapLibre GL mini-map for the dashboard.
 *
 * UI_UX_Design.md §1.4 / §1.3: a small live map with vehicle markers colored
 * by status (green=active, amber=idle, red=overspeed, slate=offline). Links to
 * the full Map dashboard.
 *
 * Uses free OpenStreetMap raster tiles — no API key required.
 *
 * Tailwind shell; the MapLibre lifecycle (init + marker sync) is preserved
 * verbatim — only the surrounding chrome (card, legend, link) was restyled.
 */
export function FleetMapPreview() {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MaplibreMap | null>(null);
  const markersRef = useRef<MaplibreMarker[]>([]);
  const { data, isLoading } = useMapVehicles();
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
        const marker = new MaplibreMarker({ element: el, anchor: 'center' })
          .setLngLat([v.lng, v.lat])
          .setPopup(new MaplibrePopup({ offset: 12 }).setHTML(`<b>${v.label}</b><br/>${v.state}`));
        marker.addTo(map);
        return marker;
      });
    };

    if (map.loaded()) apply();
    else map.once('load', apply);
  }, [vehicles]);

  return (
    <WidgetCard
      titleKey="dashboard.widgets.mapPreview"
      icon={MapPin}
      loading={isLoading}
      action={
        <Link
          to="/map"
          className="text-sm font-semibold text-brand-600 hover:text-brand-700 dark:text-brand-400"
        >
          {t('dashboard.widgets.openMap')} →
        </Link>
      }
    >
      <div className="relative h-[220px] w-full overflow-hidden rounded-lg">
        <div ref={containerRef} className="h-full w-full" />
        {/* Legend overlay (§0.7: never rely on color alone — pair with label). */}
        <div className="absolute bottom-1.5 start-1.5 flex gap-3 rounded-md bg-white/85 px-2 py-1 backdrop-blur-sm">
          {(
            [
              ['active', mapAccents.vehicleActive],
              ['idle', mapAccents.vehicleIdle],
              ['overspeed', mapAccents.vehicleOverspeed],
              ['offline', mapAccents.vehicleOffline],
            ] as const
          ).map(([key, color]) => (
            <span key={key} className="inline-flex items-center gap-1">
              <span className="size-2 rounded-full" style={{ backgroundColor: color }} />
              <span className="text-xs text-gray-500 dark:text-graydark-600">
                {t(`dashboard.map.${key}`)}
              </span>
            </span>
          ))}
        </div>
        {isLoading && (
          <div className="absolute inset-0 animate-pulse bg-gray-100 dark:bg-white/5" />
        )}
      </div>
    </WidgetCard>
  );
}
