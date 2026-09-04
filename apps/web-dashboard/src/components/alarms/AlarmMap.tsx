import { Map as MaplibreGL, Marker as MaplibreMarker } from 'maplibre-gl';
import type { Map as MaplibreMap } from 'maplibre-gl';
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
import { loadPersistedBasemap, rasterMapStyle } from '@/lib/basemaps';
import { markerDataUrl, selectedMarkerDataUrl } from '@/lib/map-markers';
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

export function AlarmMap({ alarms, selectedId, onSelect }: AlarmMapProps) {
  const { t, i18n } = useTranslation();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MaplibreMap | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const markersRef = useRef<MaplibreMarker[]>([]);
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
    setMapReady(true);
    return () => {
      for (const m of markersRef.current) m.remove();
      markersRef.current = [];
      map.remove();
      mapRef.current = null;
      setMapReady(false);
    };
  }, []);

  // Re-render markers whenever alarms / selection change.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const render = () => {
      for (const m of markersRef.current) m.remove();
      markersRef.current = [];

      for (const a of alarms) {
        const color = severityColor(a.severity);
        const isSel = a.id === selectedId;
        const el = document.createElement('img');
        el.src = isSel ? selectedMarkerDataUrl(color) : markerDataUrl(color);
        el.style.cursor = 'pointer';
        el.dataset.alarmId = a.id;
        el.title = `${a.vehicleLabel} · ${localizeAlarmMessage(t, a)}`;
        const marker = new MaplibreMarker({ element: el }).setLngLat([a.lng, a.lat]).addTo(map);
        el.addEventListener('click', (ev) => {
          ev.stopPropagation();
          onSelectRef.current(a.id);
        });
        markersRef.current.push(marker);
      }
    };

    if (map.loaded()) render();
    else runWhenStyleReady(map, render);
  }, [alarms, selectedId, t]);

  if (alarms.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <span className="text-sm text-gray-500 dark:text-graydark-600">{t('alarms.empty')}</span>
      </div>
    );
  }

  return (
    <div className="relative h-full min-h-[400px] w-full">
      <div ref={containerRef} className="h-full min-h-[400px] w-full" />
      <MapSettingsPanel basemap={basemap} onBasemapChange={setBasemap} placement="corner" />
    </div>
  );
}
