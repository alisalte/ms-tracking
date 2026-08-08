/**
 * Client-side point clustering for the live-tracking map.
 *
 * UI_UX_Design.md §2.4 / §2.7 + MapEngine spec §3.3: below ~2,000 visible
 * vehicles the fleet is clustered in-browser with `supercluster` (the library
 * that powers Mapbox/MapLibre GL clustering). Above that threshold the spec
 * calls a server endpoint (`GET /api/v1/map/clusters?bbox=&zoom=`); this module
 * is the client tier and stays the single place to swap that in.
 */
import Supercluster from 'supercluster';

import type { MapVehicle } from '@/types/fleet.types';

/** A point that supercluster has *not* merged — carries the source vehicle. */
export interface ClusterPoint {
  kind: 'point';
  vehicle: MapVehicle;
  lng: number;
  lat: number;
}

/** A cluster supercluster produced — carries a member count + averaged center. */
export interface ClusterFeature {
  kind: 'cluster';
  id: number;
  count: number;
  lng: number;
  lat: number;
}

/** The result of clustering the visible fleet for the current viewport. */
export type ClusterResult = Array<ClusterPoint | ClusterFeature>;

/** `[westLng, southLat, eastLng, northLat]` — MapLibre LngLatBounds-like bbox. */
export type BBox = [number, number, number, number];

/** Properties carried per point so clusters can reference the source vehicle. */
interface PointProps {
  vehicle: MapVehicle;
}

const INDEX = new Supercluster<PointProps, { cluster_id?: number }>({
  radius: 48, // cluster radius in pixels at the zoom level
  maxZoom: 16, // beyond zoom 16 everything is individual markers
});

let loadedKey: string | null = null;

/**
 * (Re)load the index when the fleet identity changes. Keys on the sorted id
 * list so a position-only refresh (same vehicles, new coords) re-loads too —
 * supercluster's `load` is cheap for our demo size.
 */
function ensureLoaded(vehicles: MapVehicle[]) {
  const key = vehicles
    .map((v) => v.id)
    .sort()
    .join('|');
  if (key === loadedKey) return;
  const points = vehicles.map((v) => ({
    type: 'Feature' as const,
    geometry: { type: 'Point' as const, coordinates: [v.lng, v.lat] },
    properties: { vehicle: v },
  }));
  INDEX.load(points);
  loadedKey = key;
}

/**
 * Cluster the fleet for the given viewport + zoom.
 *
 * @param vehicles full (already-filtered) fleet.
 * @param bbox `[westLng, southLat, eastLng, northLat]` of the viewport.
 * @param zoom current integer-ish map zoom.
 */
export function cluster(vehicles: MapVehicle[], bbox: BBox, zoom: number): ClusterResult {
  ensureLoaded(vehicles);
  const features = INDEX.getClusters(bbox, Math.round(zoom));
  return features.map((f): ClusterPoint | ClusterFeature => {
    const [lng, lat] = f.geometry.coordinates;
    // supercluster sets `cluster: true` only on merged features.
    if ('cluster' in f.properties && f.properties.cluster) {
      const props = f.properties as { cluster: true; cluster_id: number; point_count: number };
      return { kind: 'cluster', id: props.cluster_id, count: props.point_count, lng, lat };
    }
    const props = f.properties as PointProps;
    return { kind: 'point', vehicle: props.vehicle, lng, lat };
  });
}

/** Zoom level at which a cluster breaks apart (for "click cluster → zoom in"). */
export function expandZoom(clusterId: number, fallbackZoom: number): number {
  try {
    return INDEX.getClusterExpansionZoom(clusterId);
  } catch {
    return Math.min(16, Math.round(fallbackZoom) + 2);
  }
}
