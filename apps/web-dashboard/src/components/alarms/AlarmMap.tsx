import { Map as MaplibreGL, Marker as MaplibreMarker } from 'maplibre-gl';
import type { LngLatBoundsLike, Map as MaplibreMap } from 'maplibre-gl';
/**
 * AlarmMap — the spatial view of the Alarm Center.
 *
 * A MapLibre GL map (shared Google/OSM/Esri raster, same catalog as FleetMap)
 * alarms as severity-colored markers. Clicking a marker opens the detail
 * drawer. Markers are managed imperatively (create/remove, tracked in a ref)
 * exactly like FleetMap — proven, avoids React reconciliation cost.
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { severityColor } from '@/components/alarms/AlarmTypeIcon';
import { MapSettingsPanel } from '@/components/map/MapSettingsPanel';
import { NO_OVERLAY_LAYERS, useFollowBasemap } from '@/hooks/useBasemap';
import { localizeAlarmMessage } from '@/lib/alarm-copy';
import { hasAlarmCoordinates } from '@/lib/alarm-evidence';
import { loadPersistedBasemap, rasterMapStyle } from '@/lib/basemaps';
import { runWhenStyleReady } from '@/lib/map-ready';
import type { Alarm } from '@/types/alarm.types';

interface AlarmMapProps {
  /** The (already-filtered) alarms to render. */
  alarms: Alarm[];
  /** Currently selected alarm id (marker highlight). */
  selectedId?: string | null;
  /** Open the detail drawer for an alarm. */
  onSelect: (id: string) => void;
}

/** Pin-style SVG — larger than the 20px fleet dots so alarms read on busy basemaps. */
function alarmPinDataUrl(color: string, selected: boolean): string {
  const size = selected ? 36 : 28;
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24">
      <path fill="${color}" stroke="#FFFFFF" stroke-width="1.5"
        d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/>
      <circle cx="12" cy="9" r="2.5" fill="#FFFFFF"/>
    </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.trim())}`;
}

export function AlarmMap({ alarms, selectedId, onSelect }: AlarmMapProps) {
  const { t, i18n } = useTranslation();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MaplibreMap | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const markersRef = useRef<MaplibreMarker[]>([]);
  const fittedRef = useRef(false);
  const { basemap, setBasemap } = useFollowBasemap(mapRef, NO_OVERLAY_LAYERS, mapReady);

  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
  });

  // Initialize the map once. Language/basemap swaps go through useFollowBasemap.
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-once by design
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new MaplibreGL({
      container: containerRef.current,
      style: rasterMapStyle(loadPersistedBasemap(), i18n.language),
      center: [51.338, 35.719],
      zoom: 11,
      attributionControl: { compact: true },
    });
    mapRef.current = map;

    const onLoad = () => {
      map.resize();
      setMapReady(true);
    };
    if (map.loaded()) onLoad();
    else map.once('load', onLoad);

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
      fittedRef.current = false;
    };
  }, []);

  // Re-render markers whenever alarms / selection change.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const render = () => {
      for (const m of markersRef.current) m.remove();
      markersRef.current = [];

      const withCoords: Alarm[] = [];
      for (const a of alarms) {
        if (!hasAlarmCoordinates(a)) continue;
        withCoords.push(a);
        const color = severityColor(a.severity);
        const isSel = a.id === selectedId;
        const el = document.createElement('img');
        el.src = alarmPinDataUrl(color, isSel);
        el.width = isSel ? 36 : 28;
        el.height = isSel ? 36 : 28;
        el.alt = '';
        el.style.cursor = 'pointer';
        el.dataset.alarmId = a.id;
        el.title = `${a.vehicleLabel} · ${localizeAlarmMessage(t, a)}`;
        const marker = new MaplibreMarker({
          element: el,
          anchor: 'bottom',
        })
          .setLngLat([a.lng, a.lat])
          .addTo(map);
        el.addEventListener('click', (ev) => {
          ev.stopPropagation();
          onSelectRef.current(a.id);
        });
        markersRef.current.push(marker);
      }

      // First paint with pins: frame them so the map is not an empty Tehran tile.
      if (!fittedRef.current && withCoords.length > 0 && !selectedId) {
        fittedRef.current = true;
        if (withCoords.length === 1) {
          map.easeTo({
            center: [withCoords[0].lng, withCoords[0].lat],
            zoom: 14,
            duration: 400,
          });
        } else {
          let minLng = withCoords[0].lng;
          let maxLng = withCoords[0].lng;
          let minLat = withCoords[0].lat;
          let maxLat = withCoords[0].lat;
          for (const a of withCoords) {
            minLng = Math.min(minLng, a.lng);
            maxLng = Math.max(maxLng, a.lng);
            minLat = Math.min(minLat, a.lat);
            maxLat = Math.max(maxLat, a.lat);
          }
          const bounds: LngLatBoundsLike = [
            [minLng, minLat],
            [maxLng, maxLat],
          ];
          map.fitBounds(bounds, { padding: 64, maxZoom: 14, duration: 400 });
        }
      }
    };

    if (map.loaded()) render();
    else runWhenStyleReady(map, render);
  }, [alarms, selectedId, t]);

  // Fly to the open alarm so "show on map" from the drawer lands on the pin.
  const flewToId = useRef<string | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !selectedId) return;
    const a = alarms.find((x) => x.id === selectedId);
    if (!a || !hasAlarmCoordinates(a)) return;
    if (flewToId.current === selectedId) return;
    flewToId.current = selectedId;
    map.flyTo({ center: [a.lng, a.lat], zoom: 15, duration: 800 });
  }, [mapReady, selectedId, alarms]);

  return (
    <div className="relative h-full min-h-[400px] w-full">
      <div ref={containerRef} className="h-full min-h-[400px] w-full" />
      {alarms.length === 0 ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-white/70 dark:bg-graydark-200/70">
          <span className="text-sm text-gray-500 dark:text-graydark-600">{t('alarms.empty')}</span>
        </div>
      ) : null}
      <MapSettingsPanel basemap={basemap} onBasemapChange={setBasemap} placement="corner" />
    </div>
  );
}
