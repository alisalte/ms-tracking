/**
 * Douglas-Peucker polyline simplification (08 §9.3).
 *
 * Reduces a position polyline to its essential shape within a tolerance ε
 * (default 5m for map replay). An 8K-point day compresses to ~800 points for
 * playback without visible fidelity loss.
 *
 * Pure, recursive. Works on any `{lat, lng}` point sequence.
 */

export interface SimplifiablePoint {
  readonly lat: number;
  readonly lng: number;
}

const EARTH_RADIUS_M = 6_371_000;
const toRad = (deg: number): number => (deg * Math.PI) / 180;

/** Perpendicular distance from point P to line segment AB (meters, haversine approx). */
function perpendicularDistance(
  p: SimplifiablePoint,
  a: SimplifiablePoint,
  b: SimplifiablePoint,
): number {
  // Project P onto the great-circle segment AB, return the cross-track distance.
  // For short segments (< 100km) a flat-earth approximation is sufficient.
  const ax = a.lng;
  const ay = a.lat;
  const bx = b.lng;
  const by = b.lat;
  const dx = bx - ax;
  const dy = by - ay;
  if (dx === 0 && dy === 0) {
    return haversineDistanceMeters(a, p);
  }
  const t = Math.max(0, Math.min(1, ((p.lng - ax) * dx + (p.lat - ay) * dy) / (dx * dx + dy * dy)));
  const proj: SimplifiablePoint = { lat: ay + t * dy, lng: ax + t * dx };
  return haversineDistanceMeters(proj, p);
}

function haversineDistanceMeters(a: SimplifiablePoint, b: SimplifiablePoint): number {
  const phi1 = toRad(a.lat);
  const phi2 = toRad(b.lat);
  const dPhi = toRad(b.lat - a.lat);
  const dLambda = toRad(b.lng - a.lng);
  const h = Math.sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/**
 * Simplify a polyline using Douglas-Peucker. Returns a subset of the points
 * whose shape is within `epsilonMeters` of the original. Preserves endpoints.
 */
export function simplify<P extends SimplifiablePoint>(
  points: readonly P[],
  epsilonMeters = 5,
): P[] {
  if (points.length <= 2) return [...points];

  let maxDist = 0;
  let maxIdx = 0;
  const first = points[0] ?? { lat: 0, lng: 0 };
  const last = points[points.length - 1] ?? { lat: 0, lng: 0 };

  for (let i = 1; i < points.length - 1; i++) {
    const d = perpendicularDistance(points[i] ?? first, first, last);
    if (d > maxDist) {
      maxDist = d;
      maxIdx = i;
    }
  }

  if (maxDist > epsilonMeters) {
    const left = simplify(points.slice(0, maxIdx + 1), epsilonMeters);
    const right = simplify(points.slice(maxIdx), epsilonMeters);
    // Merge, dropping the duplicated junction point.
    return [...left.slice(0, -1), ...right];
  }
  // All intermediate points are within tolerance — keep only endpoints.
  const startP = points[0];
  const endP = points[points.length - 1];
  return startP && endP ? [startP, endP] : [...points];
}
