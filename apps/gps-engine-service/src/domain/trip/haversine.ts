/**
 * Haversine distance + mileage filters (07 §4, §6.2; GPSEngine.md §6).
 *
 * The default mileage method: great-circle distance between consecutive
 * positions on a sphere of radius R = 6,371,000 m. Filters are applied to every
 * step to suppress GPS noise (07 §4.3 / GPSEngine.md §6.3):
 *   - dedupe-distance: ignore steps < threshold (default 1m).
 *   - stop-zeroing: while the vehicle is stationary (speed ≤ stop-speed), the
 *     contribution is 0 (avoids creep inflating mileage).
 *   - max-step: ignore steps implying a speed above the plausible cap (jump filter).
 */

/** Earth radius in meters (GPSEngine.md §6.2). */
const EARTH_RADIUS_M = 6_371_000;

/** Degrees → radians. */
const toRad = (deg: number): number => (deg * Math.PI) / 180;

/**
 * Great-circle distance between two WGS-84 points (meters).
 * a = sin²(Δφ/2) + cos(φ1)·cos(φ2)·sin²(Δλ/2); c = 2·atan2(√a, √(1−a)); d = R·c.
 */
export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const dPhi = toRad(lat2 - lat1);
  const dLambda = toRad(lng2 - lng1);
  const a = Math.sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_M * c;
}

export interface MileageFilterOptions {
  /** Ignore steps shorter than this (meters). Default 1. */
  readonly dedupeDistanceM: number;
  /** Ignore steps implying a speed above this (km/h). Default 300. */
  readonly maxPlausibleSpeedKmh: number;
}

/**
 * Compute the filtered distance step between two consecutive positions. Returns
 * 0 for sub-threshold (dedupe), implausible (jump), or stationary (stop-zeroed)
 * steps. `prevSpeedKmh` is the *previous* position's speed (stop-zeroing keys off
 * whether the vehicle was already stopped).
 *
 * Pure — no side effects.
 */
export function filteredDistanceStep(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
  prevCapturedAt: Date,
  currCapturedAt: Date,
  prevSpeedKmh: number,
  opts: MileageFilterOptions,
): number {
  // Stop-zeroing: if the vehicle was already stationary, the step is noise.
  if (prevSpeedKmh <= 0.1) return 0;

  const raw = haversineMeters(lat1, lng1, lat2, lng2);

  // Dedupe-distance filter.
  if (raw < opts.dedupeDistanceM) return 0;

  // Max-plausible-speed filter (jump / teleport).
  const dtSec = Math.max((currCapturedAt.getTime() - prevCapturedAt.getTime()) / 1000, 1);
  const impliedSpeedKmh = (raw / 1000 / dtSec) * 3600;
  if (impliedSpeedKmh > opts.maxPlausibleSpeedKmh) return 0;

  return raw;
}
