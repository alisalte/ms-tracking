/**
 * Geofence input validation (Sprint I §7/§8/§56) — pure, framework-free.
 *
 * Structural checks that do not need PostGIS live here:
 *   - coordinate range checks (lat [-90,90], lng [-180,180], boundaries INCLUDED,
 *     ±91/±181 rejected),
 *   - circle radius bounds (> 0, ≤ 5,000 km documented cap),
 *   - polygon ring structure: array of [lng,lat] positions, closed
 *     (first === last), ≥ 4 positions (3 unique vertices + closure).
 *
 * GEOMETRIC validity (self-intersection, ring orientation… ) is NOT guessed in
 * JavaScript — it is delegated to PostGIS `ST_IsValid` / `ST_IsValidReason` in
 * `GeofenceRepository.validateGeometry()` (Sprint I §8: the server stays
 * authoritative and never silently repairs user geometry).
 *
 * `GeofenceValidationError` is a controlled 4xx: controllers map it to
 * HttpStatus.BAD_REQUEST with `{ message, code }` — no stack traces leak.
 */

export type GeofenceInputType = 'POLYGON' | 'CIRCLE';

/** Bounded, documented radius cap (meters) — 5,000 km spans a continent. */
export const MAX_RADIUS_METERS = 5_000_000;
/** Minimum unique vertices for a valid polygon (GeoJSON ring = 4 positions). */
export const MIN_POLYGON_POSITIONS = 4;
/** Documented upper bound per polygon (DoS guard for pathological payloads). */
export const MAX_POLYGON_POSITIONS = 2_000;

export class GeofenceValidationError extends Error {
  public override readonly name = 'GeofenceValidationError';
  constructor(
    message: string,
    public readonly code:
      | 'INVALID_TYPE'
      | 'INVALID_NAME'
      | 'INVALID_COORDINATE'
      | 'INVALID_RADIUS'
      | 'INVALID_RING'
      | 'INVALID_GEOJSON'
      | 'INVALID_ALERT_ON'
      | 'INVALID_DWELL'
      | 'INVALID_STATUS'
      | 'INVALID_GEOMETRY',
    public readonly detail?: unknown,
  ) {
    super(message);
  }
}

export function isValidLatitude(lat: number): boolean {
  return Number.isFinite(lat) && lat >= -90 && lat <= 90;
}

export function isValidLongitude(lng: number): boolean {
  return Number.isFinite(lng) && lng >= -180 && lng <= 180;
}

/** Validate a circle input (Sprint I §7): center + positive radius. */
export function validateCircleInput(input: {
  latitude: number;
  longitude: number;
  radiusMeters: number;
}): void {
  if (!isValidLatitude(input.latitude)) {
    throw new GeofenceValidationError(
      `Circle center latitude ${input.latitude} out of range [-90, 90]`,
      'INVALID_COORDINATE',
    );
  }
  if (!isValidLongitude(input.longitude)) {
    throw new GeofenceValidationError(
      `Circle center longitude ${input.longitude} out of range [-180, 180]`,
      'INVALID_COORDINATE',
    );
  }
  if (!Number.isFinite(input.radiusMeters) || input.radiusMeters <= 0) {
    throw new GeofenceValidationError(
      `Circle radius must be > 0 (got ${input.radiusMeters})`,
      'INVALID_RADIUS',
    );
  }
  if (input.radiusMeters > MAX_RADIUS_METERS) {
    throw new GeofenceValidationError(
      `Circle radius ${input.radiusMeters} m exceeds the ${MAX_RADIUS_METERS} m cap`,
      'INVALID_RADIUS',
    );
  }
}

/**
 * Validate a polygon ring (Sprint I §8): GeoJSON outer ring as
 * `number[][]` of `[lng, lat]`, closed, within bounds.
 * Self-intersection is checked later by PostGIS ST_IsValid.
 */
export function validatePolygonRing(ring: number[][]): void {
  if (!Array.isArray(ring) || ring.length < MIN_POLYGON_POSITIONS) {
    throw new GeofenceValidationError(
      `Polygon ring needs at least ${MIN_POLYGON_POSITIONS} positions (3 unique vertices + closure); got ${Array.isArray(ring) ? ring.length : 'non-array'}`,
      'INVALID_RING',
    );
  }
  if (ring.length > MAX_POLYGON_POSITIONS) {
    throw new GeofenceValidationError(
      `Polygon ring exceeds ${MAX_POLYGON_POSITIONS} positions (got ${ring.length})`,
      'INVALID_RING',
    );
  }
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (
    !Array.isArray(first) ||
    !Array.isArray(last) ||
    first[0] !== last[0] ||
    first[1] !== last[1]
  ) {
    throw new GeofenceValidationError(
      'Polygon ring must be closed (first position === last position)',
      'INVALID_RING',
    );
  }
  for (const pos of ring) {
    if (
      !Array.isArray(pos) ||
      pos.length < 2 ||
      !Number.isFinite(pos[0]) ||
      !Number.isFinite(pos[1])
    ) {
      throw new GeofenceValidationError(
        'Polygon ring contains a non-finite [lng, lat] position',
        'INVALID_COORDINATE',
      );
    }
    const lng = pos[0] as number;
    const lat = pos[1] as number;
    if (!isValidLongitude(lng) || !isValidLatitude(lat)) {
      throw new GeofenceValidationError(
        `Polygon vertex [${lng}, ${lat}] out of range (lng [-180,180], lat [-90,90])`,
        'INVALID_COORDINATE',
      );
    }
  }
}

/** Validate the GeoJSON Polygon boundary object (type + one outer ring). */
export function validateBoundaryGeoJson(
  boundary: unknown,
): asserts boundary is { type: 'Polygon'; coordinates: number[][][] } {
  if (
    boundary === null ||
    typeof boundary !== 'object' ||
    Array.isArray(boundary) ||
    (boundary as { type?: unknown }).type !== 'Polygon' ||
    !Array.isArray((boundary as { coordinates?: unknown }).coordinates) ||
    (boundary as { coordinates: unknown[] }).coordinates.length < 1
  ) {
    throw new GeofenceValidationError(
      'boundary must be a GeoJSON Polygon { type, coordinates }',
      'INVALID_GEOJSON',
    );
  }
  const rings = (boundary as { coordinates: number[][][] }).coordinates;
  if (rings.length > 1) {
    throw new GeofenceValidationError(
      'Only single-ring (no holes) polygons are supported',
      'INVALID_GEOJSON',
    );
  }
  const outer = rings[0];
  if (!outer) {
    throw new GeofenceValidationError('Polygon has an empty outer ring', 'INVALID_RING');
  }
  validatePolygonRing(outer);
}

export const GEOFENCE_STATUSES = ['ACTIVE', 'INACTIVE', 'ARCHIVED'] as const;
export type GeofenceStatus = (typeof GEOFENCE_STATUSES)[number];

export const GEOFENCE_ALERTS = ['ENTER', 'EXIT', 'DWELL'] as const;
export type GeofenceAlertKind = (typeof GEOFENCE_ALERTS)[number];

/** Validate alertOn list (subset of ENTER|EXIT|DWELL, no duplicates). */
export function validateAlertOn(alertOn: readonly unknown[]): void {
  if (!Array.isArray(alertOn) || alertOn.length === 0) {
    throw new GeofenceValidationError(
      'alertOn must be a non-empty subset of ENTER|EXIT|DWELL',
      'INVALID_ALERT_ON',
    );
  }
  const seen = new Set<string>();
  for (const a of alertOn) {
    if (typeof a !== 'string' || !GEOFENCE_ALERTS.includes(a as GeofenceAlertKind)) {
      throw new GeofenceValidationError(
        `alertOn entry ${JSON.stringify(a)} not in ENTER|EXIT|DWELL`,
        'INVALID_ALERT_ON',
      );
    }
    if (seen.has(a)) {
      throw new GeofenceValidationError(`alertOn contains duplicate ${a}`, 'INVALID_ALERT_ON');
    }
    seen.add(a);
  }
}

/** Validate a status transition target. */
export function validateStatus(status: unknown): asserts status is GeofenceStatus {
  if (typeof status !== 'string' || !GEOFENCE_STATUSES.includes(status as GeofenceStatus)) {
    throw new GeofenceValidationError(
      `status must be one of ${GEOFENCE_STATUSES.join('|')}`,
      'INVALID_STATUS',
    );
  }
}
