import { MapPin } from 'lucide-react';
import { Map as MaplibreMap, Marker as MaplibreMarker, Popup as MaplibrePopup } from 'maplibre-gl';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { useMapVehicles } from '@/api/fleet.api';
import { Badge, Skeleton } from '@/components/tailwind-ui';
import { NO_OVERLAY_LAYERS, useFollowBasemap } from '@/hooks/useBasemap';
import { useMapMarkerStyle } from '@/hooks/useMapMarkerStyle';
import { loadPersistedBasemap, rasterMapStyle } from '@/lib/basemaps';
import { formatNumber } from '@/lib/format-number';
import { PRESENCE_COLORS, paintVehicleMarker, vehicleColor } from '@/lib/map-markers';
import type { MapVehicle, VehiclePresence } from '@/types/fleet.types';

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
  const { t, i18n } = useTranslation();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MaplibreMap | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const markersRef = useRef<MaplibreMarker[]>([]);
  const { data, isLoading, isError, refetch } = useMapVehicles();
  const vehicles = data ?? [];
  useFollowBasemap(mapRef, NO_OVERLAY_LAYERS, mapReady);
  const [markerStyle] = useMapMarkerStyle();

  // Initialize the map once. Language/basemap swaps go through useFollowBasemap.
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-once by design
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new MaplibreMap({
      container: containerRef.current,
      style: rasterMapStyle(loadPersistedBasemap(), i18n.language),
      center: [51.338, 35.719],
      zoom: 11,
      attributionControl: false,
      dragRotate: false,
      pitchWithRotate: false,
    });
    mapRef.current = map;
    setMapReady(true);

    let ro: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined' && containerRef.current) {
      ro = new ResizeObserver(() => {
        map.resize();
      });
      ro.observe(containerRef.current);
    }

    return () => {
      ro?.disconnect();
      for (const m of markersRef.current) m.remove();
      markersRef.current = [];
      map.remove();
      mapRef.current = null;
      setMapReady(false);
    };
  }, []);

  // Sync markers when vehicles arrive.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || vehicles.length === 0) return;

    const apply = () => {
      for (const m of markersRef.current) m.remove();
      markersRef.current = vehicles.map((v) => {
        const el = document.createElement('div');
        el.className = 'fv-vehicle-marker';
        paintVehicleMarker(el, v.type, vehicleColor(v), {
          heading: v.heading,
          id: v.id,
          style: markerStyle,
        });
        el.setAttribute('aria-label', v.label);
        el.style.cursor = 'pointer';
        const presence = v.presence ?? 'UNKNOWN';
        const title = v.name?.trim() || v.label;
        const plate = v.plate?.trim();
        const plateLine = plate && plate !== title ? `<br/>${plate}` : '';
        const marker = new MaplibreMarker({ element: el, anchor: 'center' })
          .setLngLat([v.lng, v.lat])
          .setPopup(
            new MaplibrePopup({ offset: 12 }).setHTML(
              `<b>${title}</b>${plateLine}<br/>${t(`map.presence.${presence}`)} · ${v.speed} km/h`,
            ),
          );
        marker.addTo(map);
        return marker;
      });
    };

    if (map.loaded()) apply();
    else map.once('load', apply);
  }, [vehicles, t, markerStyle]);

  const roster = vehicles.slice(0, 8);

  return (
    <DashboardCard
      titleKey="dashboard.widgets.mapPreview"
      accent="teal"
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
      <div className="grid min-h-[280px] grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(220px,280px)]">
        <div className="relative h-[240px] w-full overflow-hidden lg:h-[340px]">
          <div ref={containerRef} className="h-full w-full" />
          <div className="absolute bottom-2 start-2 flex flex-wrap items-center gap-3 rounded-xl border border-white/60 bg-white/80 px-2.5 py-1 shadow-sm backdrop-blur-md">
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
                className="rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 shadow-sm hover:bg-gray-50 dark:border-white/10 dark:bg-graydark-300 dark:text-graydark-800"
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
              <span className="rounded-xl border border-gray-200 bg-white/90 px-3 py-1 text-xs font-medium text-gray-500 shadow-sm dark:border-white/10 dark:bg-graydark-300/90 dark:text-graydark-700">
                {t('map.emptyTitle')}
              </span>
            </div>
          )}
        </div>

        <div className="flex max-h-[340px] flex-col border-t border-gray-100 lg:border-t-0 lg:border-s dark:border-white/8">
          <div className="flex items-center justify-between px-3 py-2.5">
            <p className="text-xs font-semibold text-gray-600 dark:text-graydark-700">
              {t('dashboard.widgets.vehicleList')}
            </p>
            <span className="text-[11px] tabular-nums text-gray-400">
              {formatNumber(vehicles.length, i18n.language)}
            </span>
          </div>
          {roster.length === 0 ? (
            <p className="px-3 pb-3 text-xs text-gray-400">{t('dashboard.empty.vehicleList')}</p>
          ) : (
            <ul className="fv-scroll min-h-0 flex-1 list-none overflow-y-auto p-0">
              {roster.map((vehicle) => (
                <VehicleRosterRow key={vehicle.id} vehicle={vehicle} />
              ))}
            </ul>
          )}
        </div>
      </div>
    </DashboardCard>
  );
}

function VehicleRosterRow({ vehicle }: { vehicle: MapVehicle }) {
  const { t, i18n } = useTranslation();
  const title = vehicle.name?.trim() || vehicle.label;
  const stateKey =
    vehicle.state === 'overspeed' ? 'dashboard.map.overspeed' : `dashboard.states.${vehicle.state}`;
  const tone =
    vehicle.state === 'driving'
      ? 'success'
      : vehicle.state === 'idle'
        ? 'warning'
        : vehicle.state === 'offline' || vehicle.state === 'overspeed'
          ? 'danger'
          : 'gray';

  return (
    <li>
      <Link
        to="/map"
        className="grid grid-cols-[1fr_auto] items-center gap-2 px-3 py-2 no-underline transition-colors hover:bg-gray-50 dark:hover:bg-white/5"
      >
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-gray-800 dark:text-white">
            {title}
          </span>
          <span className="text-[11px] tabular-nums text-gray-400">
            {t('dashboard.widgets.speedKmh', {
              value: formatNumber(Math.round(vehicle.speed), i18n.language),
            })}
          </span>
        </span>
        <Badge color={tone}>{t(stateKey)}</Badge>
      </Link>
    </li>
  );
}
