/**
 * Map Engine domain types — spatial value objects (08 §2.4; MapEngine.md §2.1).
 *
 * These are the canonical shapes the services and controllers exchange. They
 * carry WGS-84 coordinates and map-domain metadata. Provider adapters normalize
 * external responses into these types.
 */

/** A geocoded address (forward or reverse geocode result). */
export interface Address {
  readonly latitude: number;
  readonly longitude: number;
  readonly formatted: string;
  readonly components: Record<string, string>;
  readonly provider: string;
}

/** A route between two or more waypoints. */
export interface RouteResult {
  readonly distanceKm: number;
  readonly durationSec: number;
  readonly geometry: readonly { lat: number; lng: number }[];
  readonly mode: 'static' | 'live' | 'optimized';
  readonly provider: string;
}

/** A map-matched / snapped point on a road. */
export interface SnappedPoint {
  readonly latitude: number;
  readonly longitude: number;
  readonly roadName: string | null;
  readonly postedLimitKmh: number | null;
  readonly confidence: number; // 0..1
  readonly provider: string;
}

/** A places/POI search result. */
export interface PlaceResult {
  readonly name: string;
  readonly category: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly distanceM: number | null;
}

/** A cluster marker (server-side H3 aggregation result). */
export interface ClusterMarker {
  readonly latitude: number;
  readonly longitude: number;
  readonly count: number;
  readonly cellId: string;
}

/** A heat-map cell (H3 density bucket). */
export interface HeatCell {
  readonly cellId: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly count: number;
  readonly metric: string;
}

/** A bounding box: west, south, east, north (minLng, minLat, maxLng, maxLat). */
export interface BoundingBox {
  readonly minLng: number;
  readonly minLat: number;
  readonly maxLng: number;
  readonly maxLat: number;
}

/** A Point of Interest. */
export interface Poi {
  readonly id: string;
  readonly tenantId: string | null;
  readonly name: string;
  readonly category: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly radiusM: number;
  readonly geofenceId: string | null;
  readonly metadata: Record<string, unknown>;
}

/** A geofence. */
export interface Geofence {
  readonly id: string;
  readonly tenantId: string;
  readonly name: string;
  readonly description: string | null;
  readonly type: 'POLYGON' | 'CIRCLE' | 'CORRIDOR';
  readonly boundaryGeoJson: unknown; // GeoJSON Polygon
  readonly centerLat: number | null;
  readonly centerLng: number | null;
  readonly radiusM: number | null;
  readonly status: 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
  readonly alertOn: readonly string[];
  readonly dwellSec: number | null;
  readonly metadata: Record<string, unknown>;
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
  /** Assigned vehicle ids (empty = tenant-wide, legacy Sprint F/G semantics). */
  readonly assignedVehicleIds: readonly string[];
}

/** Parse a bbox string "minLng,minLat,maxLng,maxLat" → BoundingBox. */
export function parseBbox(bbox: string): BoundingBox | null {
  const parts = bbox.split(',').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  return {
    minLng: parts[0] ?? 0,
    minLat: parts[1] ?? 0,
    maxLng: parts[2] ?? 0,
    maxLat: parts[3] ?? 0,
  };
}
