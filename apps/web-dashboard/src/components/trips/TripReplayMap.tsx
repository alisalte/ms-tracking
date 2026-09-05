import {
  type GeoJSONSource,
  LngLatBounds as MaplibreLngLatBounds,
  Map as MaplibreMap,
  Marker as MaplibreMarker,
} from 'maplibre-gl';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { MapSettingsPanel } from '@/components/map/MapSettingsPanel';
import { useFollowBasemap } from '@/hooks/useBasemap';
import { loadPersistedBasemap, rasterMapStyle } from '@/lib/basemaps';
import { markerDataUrl, paintVehicleMarker } from '@/lib/map-markers';
import { runWhenStyleReady } from '@/lib/map-ready';
import {
  TRIP_SPEED_LIMIT_KMH,
  fullRouteCollection,
  progressCollection,
  speedLineColor,
  speedSegmentCollection,
} from '@/lib/trip-events';
import { mapAccents, status } from '@/theme/palette';
import type { TripEvent, TripWaypoint, VehicleType } from '@/types/fleet.types';

interface TripReplayMapProps {
  /** Ordered position samples of the trip track. */
  waypoints: TripWaypoint[];
  /** Layered events to mark on the map (stops / idle / overspeed). */
  events: TripEvent[];
  /** Current replay index — the animated vehicle marker follows it. */
  index: number;
  /** Registry body type when known; inferred from the trip label otherwise. */
  vehicleType?: VehicleType;
}

/** Event type → marker color (stop=amber, idle=slate, overspeed=red). */
const EVENT_COLOR: Record<TripEvent['type'], string> = {
  stop: status.amber,
  idle: status.slate,
  overspeed: status.red,
  geofence: mapAccents.geofence,
};

const TEHRAN: [number, number] = [51.389, 35.689];
const MAP_HEIGHT_PX = 460;

const TRIP_OVERLAY_LAYER_IDS = [
  'route-full-casing',
  'route-full',
  'route-speed',
  'route-progress',
] as const;
const TRIP_BASEMAP_BEFORE = ['route-full-casing'] as const;

const SPEED_LEGEND = [
  { key: 'speedStopped', color: '#94A3B8' },
  { key: 'speedSlow', color: '#22C55E' },
  { key: 'speedMedium', color: '#465FFB' },
  { key: 'speedFast', color: '#F59E0B' },
  { key: 'speedOver', color: '#DC2626' },
] as const;

function raiseTripLayers(map: MaplibreMap): void {
  for (const id of TRIP_OVERLAY_LAYER_IDS) {
    if (map.getLayer(id)) map.moveLayer(id);
  }
  if (map.getLayer('basemap') && map.getLayer('route-full-casing')) {
    map.moveLayer('basemap', 'route-full-casing');
  }
}

function firstValidLngLat(waypoints: readonly TripWaypoint[]): [number, number] {
  for (const w of waypoints) {
    if (Number.isFinite(w.lat) && Number.isFinite(w.lng) && Math.abs(w.lat) <= 90) {
      return [w.lng, w.lat];
    }
  }
  return TEHRAN;
}

function eventCaption(
  event: TripEvent,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  const type = t(`trips.events.${event.type}`);
  if (event.durationMin) {
    return t('trips.replay.eventDuration', { type, minutes: event.durationMin });
  }
  if (event.label) return `${type} · ${event.label}`;
  return type;
}

function makeLabelMarker(className: string, text: string, testId: string): HTMLDivElement {
  const el = document.createElement('div');
  el.className = className;
  el.setAttribute('data-testid', testId);
  el.textContent = text;
  return el;
}

/**
 * TripReplayMap — a dedicated replay map for a single trip (TailAdmin port).
 *
 * Speed-colored track segments, a traveled-progress overlay, labeled stop /
 * idle / overspeed markers, start/end pins, and a live speed HUD. Raster
 * basemaps are opaque so overlay layers are raised above `basemap`.
 */
export function TripReplayMap({ waypoints, events, index, vehicleType }: TripReplayMapProps) {
  const { t, i18n } = useTranslation();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MaplibreMap | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const eventMarkersRef = useRef<MaplibreMarker[]>([]);
  const endpointMarkersRef = useRef<MaplibreMarker[]>([]);
  const vehicleMarkerRef = useRef<MaplibreMarker | null>(null);
  const fittedKeyRef = useRef('');
  const indexRef = useRef(index);
  const waypointsRef = useRef(waypoints);
  const eventsRef = useRef(events);
  waypointsRef.current = waypoints;
  eventsRef.current = events;
  indexRef.current = index;
  const { basemap, setBasemap } = useFollowBasemap(mapRef, TRIP_BASEMAP_BEFORE, mapReady);

  const current = waypoints[index];
  const hud = useMemo(() => {
    if (!current) return null;
    const speed = Math.round(current.speed);
    const overspeed = current.speed > TRIP_SPEED_LIMIT_KMH;
    const stopped = current.speed <= 2;
    return { speed, overspeed, stopped };
  }, [current]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-once by design
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const first = firstValidLngLat(waypointsRef.current);

    const map = new MaplibreMap({
      container: containerRef.current,
      style: rasterMapStyle(loadPersistedBasemap(), i18n.language),
      center: first,
      zoom: 12,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    setMapReady(true);

    map.on('load', () => {
      if (mapRef.current !== map) return;
      map.resize();
      if (!map.getSource('route-full')) {
        map.addSource('route-full', { type: 'geojson', data: fullRouteCollection([]) });
        map.addSource('route', { type: 'geojson', data: speedSegmentCollection([]) });
        map.addSource('route-progress', { type: 'geojson', data: progressCollection([], 0) });
        map.addLayer({
          id: 'route-full-casing',
          type: 'line',
          source: 'route-full',
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: { 'line-color': '#0F172A', 'line-width': 12, 'line-opacity': 0.55 },
        });
        map.addLayer({
          id: 'route-full',
          type: 'line',
          source: 'route-full',
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: { 'line-color': '#38BDF8', 'line-width': 7, 'line-opacity': 0.95 },
        });
        map.addLayer({
          id: 'route-speed',
          type: 'line',
          source: 'route',
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: { 'line-color': ['get', 'color'], 'line-width': 5, 'line-opacity': 1 },
        });
        map.addLayer({
          id: 'route-progress',
          type: 'line',
          source: 'route-progress',
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: { 'line-color': '#FFFFFF', 'line-width': 3, 'line-opacity': 0.9 },
        });
      }
      raiseTripLayers(map);
      paintTrack(
        map,
        waypointsRef.current,
        eventsRef.current,
        eventMarkersRef,
        endpointMarkersRef,
        t,
        fittedKeyRef,
      );
      paintProgress(map, waypointsRef.current, 0);
      paintSvgRoute(map, waypointsRef.current, indexRef.current);
      map.on('move', () => paintSvgRoute(map, waypointsRef.current, indexRef.current));
      map.on('idle', () => raiseTripLayers(map));
    });

    return () => {
      for (const m of eventMarkersRef.current) m.remove();
      eventMarkersRef.current = [];
      for (const m of endpointMarkersRef.current) m.remove();
      endpointMarkersRef.current = [];
      vehicleMarkerRef.current?.remove();
      vehicleMarkerRef.current = null;
      map.remove();
      mapRef.current = null;
      setMapReady(false);
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const apply = () =>
      paintTrack(map, waypoints, events, eventMarkersRef, endpointMarkersRef, t, fittedKeyRef);
    runWhenStyleReady(map, apply);
  }, [waypoints, events, t]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    runWhenStyleReady(map, () => {
      paintProgress(map, waypoints, index);
      paintSvgRoute(map, waypoints, index);
    });
  }, [waypoints, index]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const wp = waypoints[index];
    if (!wp) return;
    const lat = Number(wp.lat);
    const lng = Number(wp.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

    const heading = Number.isFinite(wp.heading) ? wp.heading : null;
    const tint = speedLineColor(wp.speed);

    const existing = vehicleMarkerRef.current;
    if (existing) {
      existing.setLngLat([lng, lat]);
      paintVehicleMarker(existing.getElement(), vehicleType, tint, {
        heading,
        id: 'trip-replay',
        selected: true,
      });
      return;
    }

    runWhenStyleReady(map, () => {
      if (mapRef.current !== map) return;
      const current = waypointsRef.current[indexRef.current];
      if (!current || vehicleMarkerRef.current) {
        if (current && vehicleMarkerRef.current) {
          vehicleMarkerRef.current.setLngLat([current.lng, current.lat]);
        }
        return;
      }
      const el = document.createElement('div');
      el.className = 'fv-vehicle-marker is-selected';
      paintVehicleMarker(el, vehicleType, speedLineColor(current.speed), {
        heading: Number.isFinite(current.heading) ? current.heading : null,
        id: 'trip-replay',
        selected: true,
      });
      el.setAttribute('aria-label', t('trips.replay.vehicle'));
      el.setAttribute('data-testid', 'trip-vehicle-marker');
      const marker = new MaplibreMarker({ element: el, anchor: 'center' }).setLngLat([
        current.lng,
        current.lat,
      ]);
      marker.addTo(map);
      vehicleMarkerRef.current = marker;
    });
  }, [index, waypoints, t, vehicleType]);

  return (
    <div
      className="relative w-full overflow-hidden rounded-lg"
      dir="ltr"
      style={{ height: MAP_HEIGHT_PX }}
    >
      <div
        ref={containerRef}
        data-testid="trip-replay-map"
        style={{ width: '100%', height: MAP_HEIGHT_PX }}
      />
      <MapSettingsPanel basemap={basemap} onBasemapChange={setBasemap} placement="corner" />
      {hud ? (
        <div
          className={`fv-trip-speed-hud${hud.overspeed ? ' is-overspeed' : hud.stopped ? ' is-stopped' : ''}`}
          data-testid="trip-speed-hud"
        >
          <span className="fv-trip-speed-hud__value">
            {t('trips.replay.hudSpeed', { speed: hud.speed })}
          </span>
          <span className="fv-trip-speed-hud__state">
            {hud.overspeed
              ? t('trips.events.overspeed')
              : hud.stopped
                ? t('trips.replay.hudStopped')
                : t('trips.replay.hudMoving')}
          </span>
        </div>
      ) : null}
      <div className="pointer-events-none absolute bottom-1.5 start-1.5 z-10 flex max-w-[92%] flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-white/90 px-2 py-1 backdrop-blur-sm">
        {SPEED_LEGEND.map((band) => (
          <span key={band.key} className="flex items-center gap-1">
            <span
              aria-hidden
              className="size-2 rounded-full"
              style={{ backgroundColor: band.color }}
            />
            <span className="text-xs text-gray-500 dark:text-graydark-600">
              {t(`trips.replay.legend.${band.key}`)}
            </span>
          </span>
        ))}
        {(
          [
            ['stop', status.amber],
            ['idle', status.slate],
            ['overspeed', status.red],
          ] as const
        ).map(([key, color]) => (
          <span key={key} className="flex items-center gap-1">
            <span aria-hidden className="size-2 rounded-full" style={{ backgroundColor: color }} />
            <span className="text-xs text-gray-500 dark:text-graydark-600">
              {t(`trips.replay.legend.${key}`)}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

function paintProgress(map: MaplibreMap, waypoints: readonly TripWaypoint[], index: number): void {
  const source = map.getSource('route-progress') as GeoJSONSource | undefined;
  if (!source) {
    runWhenStyleReady(map, () => {
      if (map.getSource('route-progress')) paintProgress(map, waypoints, index);
    });
    return;
  }
  source.setData(progressCollection(waypoints, index));
  raiseTripLayers(map);
  map.triggerRepaint();
}

function upsertRouteSvg(map: MaplibreMap): SVGSVGElement | null {
  const host = map.getCanvasContainer?.() ?? map.getContainer();
  if (!host) return null;
  let svg = host.querySelector('[data-testid="trip-route-overlay"]') as SVGSVGElement | null;
  if (!svg) {
    svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('data-testid', 'trip-route-overlay');
    svg.setAttribute('aria-hidden', 'true');
    svg.style.cssText =
      'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:1;overflow:visible';
    host.appendChild(svg);
  }
  return svg;
}

function paintSvgRoute(map: MaplibreMap, waypoints: readonly TripWaypoint[], index: number): void {
  const svg = upsertRouteSvg(map);
  if (!svg) return;
  const w = map.getContainer().clientWidth;
  const h = map.getContainer().clientHeight;
  if (w < 8 || h < 8) return;
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  const pts: { x: number; y: number; color: string }[] = [];
  for (let i = 0; i < waypoints.length; i++) {
    const wp = waypoints[i];
    if (!wp || !Number.isFinite(wp.lat) || !Number.isFinite(wp.lng)) continue;
    const p = map.project([wp.lng, wp.lat]);
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    const prev = i > 0 ? waypoints[i - 1] : wp;
    pts.push({
      x: p.x,
      y: p.y,
      color: speedLineColor(((prev?.speed ?? wp.speed) + wp.speed) / 2),
    });
  }
  const full = pts.map((p) => `${p.x},${p.y}`).join(' ');
  const traveled = pts
    .slice(0, Math.max(2, Math.min(index + 1, pts.length)))
    .map((p) => `${p.x},${p.y}`)
    .join(' ');
  const speedLines: string[] = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    if (!a || !b) continue;
    if (a.x === b.x && a.y === b.y) continue;
    speedLines.push(
      `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${b.color}" stroke-width="5" stroke-linecap="round" />`,
    );
  }
  svg.innerHTML = `
    <polyline points="${full}" fill="none" stroke="#0F172A" stroke-width="12" stroke-linecap="round" stroke-linejoin="round" opacity="0.45" />
    <polyline points="${full}" fill="none" stroke="#38BDF8" stroke-width="7" stroke-linecap="round" stroke-linejoin="round" />
    ${speedLines.join('')}
    <polyline points="${traveled}" fill="none" stroke="#FFFFFF" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" opacity="0.9" />
  `;
}

function paintTrack(
  map: MaplibreMap,
  waypoints: readonly TripWaypoint[],
  events: readonly TripEvent[],
  eventMarkersRef: { current: MaplibreMarker[] },
  endpointMarkersRef: { current: MaplibreMarker[] },
  t: (key: string, opts?: Record<string, unknown>) => string,
  fittedKeyRef: { current: string },
): void {
  const fullSource = map.getSource('route-full') as GeoJSONSource | undefined;
  const source = map.getSource('route') as GeoJSONSource | undefined;
  if (!source || !fullSource) {
    runWhenStyleReady(map, () => {
      if (map.getSource('route') && map.getSource('route-full')) {
        paintTrack(map, waypoints, events, eventMarkersRef, endpointMarkersRef, t, fittedKeyRef);
      }
    });
    return;
  }
  fullSource.setData(fullRouteCollection(waypoints));
  source.setData(speedSegmentCollection(waypoints));
  paintSvgRoute(map, waypoints, waypoints.length - 1);
  raiseTripLayers(map);
  map.triggerRepaint();

  for (const m of eventMarkersRef.current) m.remove();
  eventMarkersRef.current = [];
  for (const e of events) {
    if (e.lat === undefined || e.lng === undefined) continue;
    const wrap = document.createElement('div');
    wrap.className = 'fv-trip-event-pin';
    const img = document.createElement('img');
    img.src = markerDataUrl(EVENT_COLOR[e.type]);
    img.alt = `${e.type} marker`;
    img.style.width = '18px';
    img.style.height = '18px';
    const label = document.createElement('div');
    label.className = `fv-trip-event-label fv-trip-event-label--${e.type}`;
    label.setAttribute('data-testid', 'trip-event-label');
    label.textContent = eventCaption(e, t);
    wrap.append(img, label);
    const marker = new MaplibreMarker({ element: wrap, anchor: 'bottom' }).setLngLat([
      e.lng,
      e.lat,
    ]);
    marker.addTo(map);
    eventMarkersRef.current.push(marker);
  }

  for (const m of endpointMarkersRef.current) m.remove();
  endpointMarkersRef.current = [];
  const start = waypoints[0];
  const end = waypoints[waypoints.length - 1];
  if (start && Number.isFinite(start.lat) && Number.isFinite(start.lng)) {
    const marker = new MaplibreMarker({
      element: makeLabelMarker(
        'fv-trip-endpoint fv-trip-endpoint--start',
        t('trips.replay.start'),
        'trip-start-label',
      ),
      anchor: 'bottom',
    })
      .setLngLat([start.lng, start.lat])
      .addTo(map);
    endpointMarkersRef.current.push(marker);
  }
  if (end && waypoints.length > 1 && Number.isFinite(end.lat) && Number.isFinite(end.lng)) {
    const marker = new MaplibreMarker({
      element: makeLabelMarker(
        'fv-trip-endpoint fv-trip-endpoint--end',
        t('trips.replay.end'),
        'trip-end-label',
      ),
      anchor: 'bottom',
    })
      .setLngLat([end.lng, end.lat])
      .addTo(map);
    endpointMarkersRef.current.push(marker);
  }

  const coords: [number, number][] = [];
  for (const w of waypoints) {
    if (!Number.isFinite(w.lat) || !Number.isFinite(w.lng)) continue;
    if (Math.abs(w.lat) > 90 || Math.abs(w.lng) > 180) continue;
    coords.push([w.lng, w.lat]);
  }
  if (coords.length < 2) return;
  const firstCoord = coords[0];
  const lastCoord = coords[coords.length - 1];
  if (!firstCoord || !lastCoord) return;
  const fitKey = `${coords.length}|${firstCoord.join(',')}|${lastCoord.join(',')}`;
  if (fitKey === fittedKeyRef.current) return;
  fittedKeyRef.current = fitKey;
  const bounds = coords.reduce(
    (b, c) => b.extend(c),
    new MaplibreLngLatBounds(firstCoord, firstCoord),
  );
  map.resize();
  map.stop();
  map.fitBounds(bounds, { padding: 48, maxZoom: 15, duration: 0 });
}
