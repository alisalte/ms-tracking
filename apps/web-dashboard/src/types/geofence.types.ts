/**
 * Geofencing domain types (UI-facing, camelCase).
 *
 * Mirrors the wire format from map-engine-service `GET/POST /location/geofences`.
 * The wire format uses the same field names (the controller does NOT snake_case),
 * so the mapping is 1:1 — types serve as the single contract reference.
 */

/** Geofence geometry type (map-engine geo-types.ts). */
export type GeofenceType = 'POLYGON' | 'CIRCLE' | 'CORRIDOR';

/** Alert trigger rules — which transitions fire an alarm. */
export type AlertOn = 'ENTER' | 'EXIT' | 'DWELL';

/** A geofence as returned by map-engine-service. */
export interface Geofence {
  id: string;
  tenantId: string;
  name: string;
  type: GeofenceType;
  /** GeoJSON Polygon geometry (for POLYGON/CORRIDOR). */
  boundaryGeoJson: GeoJSON.Polygon | null;
  /** Center latitude (for CIRCLE). */
  centerLat: number | null;
  /** Center longitude (for CIRCLE). */
  centerLng: number | null;
  /** Radius in meters (for CIRCLE). */
  radiusM: number | null;
  /** Which transitions trigger alerts. */
  alertOn: AlertOn[];
  /** Dwell threshold in seconds (for DWELL alert). */
  dwellSec: number | null;
  /** Arbitrary metadata. */
  metadata: Record<string, unknown>;
}

/** Payload for creating a new geofence (POST /location/geofences). */
export interface CreateGeofencePayload {
  name: string;
  type: GeofenceType;
  /** GeoJSON Polygon for POLYGON type. */
  boundary?: { type: 'Polygon'; coordinates: number[][][] };
  centerLat?: number;
  centerLng?: number;
  radiusM?: number;
  alertOn?: AlertOn[];
  dwellSec?: number;
}

/** Result of a point-in-geofence check. */
export interface GeofenceContainsResult {
  geofenceIds: string[];
}
