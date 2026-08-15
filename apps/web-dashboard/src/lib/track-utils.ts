/**
 * Track utilities — historical-track preparation for map rendering (Sprint F §9/§10).
 *
 * §9: a raw position history may contain large temporal gaps (device offline,
 * compression sampling). Drawing one continuous polyline would visually invent
 * movement the vehicle never made, so the track is split into segments at gaps
 * exceeding `GAP_THRESHOLD_MS` and rendered as a MultiLineString.
 *
 * §10 (simplification): payloads are bounded server-side (validated range +
 * LIMIT-clamped query); the client additionally drops consecutive points closer
 * than `MIN_SEGMENT_DELTA_M` (pure straight-line redundancy) before rendering.
 */
import type { TrackPoint } from '@/api/map.api';

/** Consecutive points further apart than this (in time) start a new segment. */
export const GAP_THRESHOLD_MS = 10 * 60_000; // 10 minutes

/** Sub-meter jitter is dropped; ~10 m keeps the polyline light without losing shape. */
const MIN_DELTA_M = 10;

/** Great-circle distance in meters (haversine). */
function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

/**
 * Split a time-ordered track into polyline segments at temporal gaps, dropping
 * sub-`MIN_DELTA_M` duplicate points. Invalid coordinates (non-finite / out of
 * range) and unparseable timestamps are filtered out — never rendered.
 */
export function splitTrackIntoSegments(
  points: ReadonlyArray<TrackPoint>,
  gapMs: number = GAP_THRESHOLD_MS,
): Array<Array<[number, number]>> {
  const segments: Array<Array<[number, number]>> = [];
  let current: Array<[number, number]> = [];
  let lastKept: { lat: number; lng: number; ts: number } | null = null;

  for (const p of points) {
    const ts = new Date(p.capturedAt).getTime();
    const valid =
      Number.isFinite(p.latitude) &&
      Number.isFinite(p.longitude) &&
      Math.abs(p.latitude) <= 90 &&
      Math.abs(p.longitude) <= 180 &&
      Number.isFinite(ts);
    if (!valid) continue;

    const coord: [number, number] = [p.longitude, p.latitude]; // GeoJSON order
    if (lastKept && ts - lastKept.ts > gapMs) {
      // Large temporal gap — do not bridge with a straight line (§9).
      if (current.length > 0) segments.push(current);
      current = [];
    } else if (
      lastKept &&
      distanceM(lastKept, { lat: p.latitude, lng: p.longitude }) < MIN_DELTA_M
    ) {
      // Redundant sub-threshold point — skip (§10).
      continue;
    }
    current.push(coord);
    lastKept = { lat: p.latitude, lng: p.longitude, ts };
  }
  if (current.length > 0) segments.push(current);
  return segments.filter((s) => s.length >= 2);
}

/** Bounds of a set of segments (for fitBounds); null when empty. */
export function segmentsBounds(
  segments: ReadonlyArray<ReadonlyArray<[number, number]>>,
): { west: number; south: number; east: number; north: number } | null {
  let west = Number.POSITIVE_INFINITY;
  let south = Number.POSITIVE_INFINITY;
  let east = Number.NEGATIVE_INFINITY;
  let north = Number.NEGATIVE_INFINITY;
  for (const seg of segments) {
    for (const [lng, lat] of seg) {
      if (lng < west) west = lng;
      if (lng > east) east = lng;
      if (lat < south) south = lat;
      if (lat > north) north = lat;
    }
  }
  return Number.isFinite(west) ? { west, south, east, north } : null;
}
