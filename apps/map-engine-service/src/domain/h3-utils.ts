/**
 * H3 hexagonal grid utilities — zoom→resolution mapping + cell encoding
 * (08 §3.3, §6.3).
 *
 * H3 is Uber's hexagonal hierarchical spatial index. The Map Engine uses it for
 * server-side clustering (>2000 visible vehicles) and heat maps (density at res-6).
 *
 * Sprint 9 implements a lightweight grid-based cell encoder (lat/lng → quantized
 * cell string) that mirrors H3's API without the full library dependency. The
 * cell string is deterministic per (lat,lng,resolution) and groups nearby points.
 * A later sprint can swap in `h3-js` for the real hexagonal grid — the interface
 * (`latLngToCell`, `cellToLatLng`) is stable.
 *
 * Zoom → H3 resolution mapping (08 §3.3):
 *   z4→res3 (~12,000km²), z8→res6 (~36km²), z12→res9 (~174m edge).
 *   Lower zoom = coarser clusters; higher zoom = finer.
 */

/** Map a map zoom level (0–22) to an H3-style resolution (0–15). */
export function zoomToResolution(zoom: number): number {
  // Linear mapping: zoom 0 → res 0, zoom 12 → res 9, zoom 20+ → res 15.
  const res = Math.round(Math.max(0, Math.min(15, (zoom / 20) * 15)));
  return res;
}

/**
 * Encode a lat/lng at a given resolution into a deterministic cell string.
 * Sprint 9: a quantized grid (not true hex H3). The cell groups points within
 * a resolution-dependent grid square. Format: `<res>:<latQ>:<lngQ>`.
 */
export function latLngToCell(lat: number, lng: number, resolution: number): string {
  // Grid size doubles each resolution step. At res 0, the whole world is one cell.
  // At res R, there are 2^R divisions per axis.
  const divisions = 2 ** resolution;
  const latQ = Math.floor(((lat + 90) / 180) * divisions);
  const lngQ = Math.floor(((lng + 180) / 360) * divisions);
  return `${resolution}:${latQ}:${lngQ}`;
}

/** Decode a cell string back to its centroid lat/lng. */
export function cellToLatLng(cellId: string): { lat: number; lng: number } {
  const [resStr, latQStr, lngQStr] = cellId.split(':');
  const resolution = Number.parseInt(resStr ?? '0', 10);
  const divisions = 2 ** resolution;
  const latQ = Number.parseInt(latQStr ?? '0', 10);
  const lngQ = Number.parseInt(lngQStr ?? '0', 10);
  const lat = ((latQ + 0.5) / divisions) * 180 - 90;
  const lng = ((lngQ + 0.5) / divisions) * 360 - 180;
  return { lat, lng };
}

/**
 * Aggregate a list of (lat,lng) points into cluster markers by cell.
 * Returns the cells sorted by count descending, capped at `maxMarkers`.
 */
export function aggregateToClusters(
  points: readonly { lat: number; lng: number }[],
  resolution: number,
  maxMarkers: number,
): readonly { latitude: number; longitude: number; count: number; cellId: string }[] {
  const cells = new Map<string, { sumLat: number; sumLng: number; count: number }>();
  for (const p of points) {
    const cellId = latLngToCell(p.lat, p.lng, resolution);
    const existing = cells.get(cellId);
    if (existing) {
      existing.sumLat += p.lat;
      existing.sumLng += p.lng;
      existing.count++;
    } else {
      cells.set(cellId, { sumLat: p.lat, sumLng: p.lng, count: 1 });
    }
  }
  return [...cells.values()]
    .map((c) => ({
      latitude: c.sumLat / c.count,
      longitude: c.sumLng / c.count,
      count: c.count,
      cellId: latLngToCell(c.sumLat / c.count, c.sumLng / c.count, resolution),
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, maxMarkers);
}
