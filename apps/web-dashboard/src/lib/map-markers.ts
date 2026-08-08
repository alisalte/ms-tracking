/**
 * Marker rendering helpers for the fleet map.
 *
 * Extracted from the dashboard mini-map so the full Map dashboard shares the
 * same status→color mapping and SVG data-URL construction. All markers are
 * inline SVG data-URLs (no external assets) colored from the semantic palette
 * (UI_UX_Design.md §0.2 mapAccents).
 */
import { mapAccents } from '@/theme/palette';
import type { MapVehicle } from '@/types/fleet.types';

/** Status → high-saturation map accent (UI_UX_Design.md §0.2 mapAccents). */
export function vehicleColor(v: Pick<MapVehicle, 'state'>): string {
  if (v.state === 'overspeed') return mapAccents.vehicleOverspeed;
  if (v.state === 'driving') return mapAccents.vehicleActive;
  if (v.state === 'idle') return mapAccents.vehicleIdle;
  return mapAccents.vehicleOffline; // stopped / offline / fallback
}

/** Encode a raw SVG string as an `<img>`-ready base64 data URL. */
function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}

/** Circular dot marker, white-ringed — the default vehicle marker. */
export function markerDataUrl(color: string): string {
  return svgDataUrl(`
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20">
      <circle cx="10" cy="10" r="6" fill="${color}" />
      <circle cx="10" cy="10" r="6" fill="none" stroke="#FFFFFF" stroke-width="2" />
    </svg>`);
}

/** Selected-vehicle marker: larger ring + accent halo for emphasis (§2.4 click). */
export function selectedMarkerDataUrl(color: string): string {
  return svgDataUrl(`
    <svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 30 30">
      <circle cx="15" cy="15" r="11" fill="${color}" opacity="0.18" />
      <circle cx="15" cy="15" r="7" fill="${color}" />
      <circle cx="15" cy="15" r="7" fill="none" stroke="#FFFFFF" stroke-width="2.5" />
    </svg>`);
}

/** Heading arrow marker, rotated to the vehicle bearing (§2.4 rotation = heading). */
export function headingArrowDataUrl(color: string, heading: number): string {
  return svgDataUrl(`
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
      <g transform="rotate(${heading} 12 12)">
        <path d="M12 3 L17 15 L12 12.5 L7 15 Z" fill="${color}" stroke="#FFFFFF" stroke-width="1.5" stroke-linejoin="round" />
      </g>
    </svg>`);
}

/** Cluster marker: a filled bubble with the member count (§2.4 clustering). */
export function clusterMarkerDataUrl(
  count: number,
  color: string = mapAccents.vehicleActive,
): string {
  const label = count > 999 ? `${Math.round(count / 100) / 10}k` : String(count);
  const width = Math.max(34, 18 + label.length * 8);
  return svgDataUrl(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${width}" viewBox="0 0 ${width} ${width}">
      <circle cx="${width / 2}" cy="${width / 2}" r="${width / 2 - 3}" fill="${color}" opacity="0.22" />
      <circle cx="${width / 2}" cy="${width / 2}" r="${width / 2 - 6}" fill="${color}" />
      <text x="${width / 2}" y="${width / 2}" font-family="Inter,Arial,sans-serif" font-size="12" font-weight="700" fill="#0F172A" text-anchor="middle" dominant-baseline="central">${label}</text>
    </svg>`);
}
