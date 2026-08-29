import type { Geofence } from '@/types/geofence.types';

/** Circle → polygon ring approximation (48 vertices, closed). */
export function circleToPolygonRing(
  centerLat: number,
  centerLng: number,
  radiusM: number,
  vertices = 48,
): number[][] {
  const ring: number[][] = [];
  const latRad = (centerLat * Math.PI) / 180;
  const metersPerDegLat = 111_320;
  const metersPerDegLng = Math.max(111_320 * Math.cos(latRad), 1e-6);
  const r = Math.max(0, radiusM);
  for (let i = 0; i <= vertices; i++) {
    const theta = (2 * Math.PI * i) / vertices;
    const dLat = (r * Math.sin(theta)) / metersPerDegLat;
    const dLng = (r * Math.cos(theta)) / metersPerDegLng;
    ring.push([centerLng + dLng, centerLat + dLat]);
  }
  return ring;
}

/** Closed GeoJSON ring for a saved fence, or null when geometry is missing. */
export function geofenceRing(
  g: Pick<Geofence, 'boundaryGeoJson' | 'centerLat' | 'centerLng' | 'radiusM'>,
): number[][] | null {
  const fromBoundary = g.boundaryGeoJson?.coordinates?.[0];
  if (fromBoundary && fromBoundary.length >= 4) return fromBoundary as number[][];
  if (g.centerLat != null && g.centerLng != null && g.radiusM != null && g.radiusM > 0) {
    return circleToPolygonRing(g.centerLat, g.centerLng, g.radiusM);
  }
  return null;
}

/** Average of ring vertices (excluding a duplicated close point). */
export function ringCentroid(ring: number[][]): [number, number] {
  const pts = ring.length >= 2 ? ring.slice(0, -1) : ring;
  if (pts.length === 0) return [0, 0];
  let lng = 0;
  let lat = 0;
  for (const p of pts) {
    lng += p[0] ?? 0;
    lat += p[1] ?? 0;
  }
  return [lng / pts.length, lat / pts.length];
}

export function geofenceFeature(
  g: Geofence,
  extra: Record<string, unknown> = {},
): GeoJSON.Feature<GeoJSON.Polygon> | null {
  const ring = geofenceRing(g);
  if (!ring) return null;
  return {
    type: 'Feature',
    id: g.id,
    properties: { id: g.id, name: g.name, ...extra },
    geometry: { type: 'Polygon', coordinates: [ring] },
  };
}
