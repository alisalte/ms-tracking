/**
 * Geofencing domain types (UI-facing, camelCase).
 *
 * Mirrors the wire format from map-engine-service. Sprint I extends the
 * contract: description, lifecycle status (ACTIVE/INACTIVE/ARCHIVED),
 * timestamps, and assigned vehicle ids (empty = tenant-wide, legacy
 * Sprint F/G semantics).
 */

/** Geofence geometry type (map-engine geo-types.ts). */
export type GeofenceType = 'POLYGON' | 'CIRCLE' | 'CORRIDOR';

/** Alert trigger rules — which transitions fire an alarm. */
export type AlertOn = 'ENTER' | 'EXIT' | 'DWELL';

/** Lifecycle status (Sprint I §17). ARCHIVED = soft-deleted. */
export type GeofenceStatus = 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';

/** A geofence as returned by map-engine-service. */
export interface Geofence {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  type: GeofenceType;
  /** GeoJSON Polygon geometry (for POLYGON/CORRIDOR). */
  boundaryGeoJson: GeoJSON.Polygon | null;
  /** Center latitude (for CIRCLE). */
  centerLat: number | null;
  /** Center longitude (for CIRCLE). */
  centerLng: number | null;
  /** Radius in meters (for CIRCLE). */
  radiusM: number | null;
  /** Lifecycle status — only ACTIVE geofences are evaluated (Sprint I). */
  status: GeofenceStatus;
  /** Which transitions trigger alerts. */
  alertOn: AlertOn[];
  /** Dwell threshold in seconds (for DWELL alert). */
  dwellSec: number | null;
  /** Arbitrary metadata. */
  metadata: Record<string, unknown>;
  createdAt: string | null;
  updatedAt: string | null;
  /** Assigned vehicle ids (empty = applies to every tenant vehicle). */
  assignedVehicleIds: string[];
}

/** Payload for creating a new geofence (POST /geofences). */
export interface CreateGeofencePayload {
  name: string;
  type: GeofenceType;
  description?: string;
  /** GeoJSON Polygon for POLYGON type. */
  boundary?: { type: 'Polygon'; coordinates: number[][][] };
  centerLat?: number;
  centerLng?: number;
  radiusM?: number;
  alertOn?: AlertOn[];
  dwellSec?: number;
}

/** Mutable fields for PUT /geofences/:id. */
export interface UpdateGeofencePayload extends Partial<CreateGeofencePayload> {}

/** List filters for GET /geofences (Sprint I §11). */
export interface GeofenceListFilters {
  status?: GeofenceStatus | 'ACTIVE,INACTIVE' | 'ARCHIVED';
  type?: GeofenceType;
  search?: string;
  vehicleId?: string;
  limit?: number;
  cursor?: string | null;
}

/** Cursor-paginated page (map-engine listPage shape). */
export interface GeofencePage {
  items: Geofence[];
  nextCursor: string | null;
}

/** Result of a point-in-geofence check. */
export interface GeofenceContainsResult {
  geofenceIds: string[];
}
