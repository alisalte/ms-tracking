/**
 * Marker rendering helpers for the fleet map.
 *
 * Body silhouettes come from `@/lib/vehicle-icons` (one catalog, every map).
 * Status still drives fill color (UI_UX_Design.md §0.2 mapAccents); heading
 * rotates the body around the GPS anchor. No per-status SVG files.
 */
import type { MapMarkerStyle } from '@/lib/map-marker-style';
import { getVehicleIcon, vehicleBodySvg } from '@/lib/vehicle-icons';
import { mapAccents, neutral } from '@/theme/palette';
import type { MapVehicle, VehiclePresence, VehicleType } from '@/types/fleet.types';

export { getVehicleIcon, inferVehicleType, resolveVehicleType } from '@/lib/vehicle-icons';

/**
 * Presence → map accent (§18). UNKNOWN renders as an offline-ish gray
 * (slightly lighter so the legend can distinguish the two).
 */
export const PRESENCE_COLORS: Record<VehiclePresence, string> = {
  ONLINE: mapAccents.vehicleActive,
  STALE: mapAccents.vehicleIdle,
  OFFLINE: mapAccents.vehicleOffline,
  UNKNOWN: neutral[300],
};

/**
 * Status → high-saturation map accent (UI_UX_Design.md §0.2 mapAccents).
 *
 * When a real connection state is present (Sprint E), presence tints the
 * marker: OFFLINE/UNKNOWN → gray, STALE → amber; only ONLINE falls through to
 * the movement state colors (driving cyan / idle yellow / overspeed rose).
 */
export function vehicleColor(
  v: Pick<MapVehicle, 'state'> & Partial<Pick<MapVehicle, 'presence'>>,
): string {
  if (v.presence === 'OFFLINE' || v.presence === 'UNKNOWN') return PRESENCE_COLORS[v.presence];
  if (v.presence === 'STALE') return PRESENCE_COLORS.STALE;
  if (v.state === 'overspeed') return mapAccents.vehicleOverspeed;
  if (v.state === 'driving') return mapAccents.vehicleActive;
  if (v.state === 'idle') return mapAccents.vehicleIdle;
  return mapAccents.vehicleOffline; // stopped / offline / fallback
}

/**
 * Compass heading for the marker. Invalid/null uses `fallback` (last good
 * heading stored on the DOM node) so the icon does not snap to north.
 */
export function markerHeading(heading: number | null | undefined, fallback = 0): number {
  if (typeof heading === 'number' && Number.isFinite(heading)) {
    const n = heading % 360;
    return n < 0 ? n + 360 : n;
  }
  return fallback;
}

/** Encode a raw SVG string as an `<img>`-ready data URL (ASCII-safe). */
function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.trim())}`;
}

/** Darken / lighten hex for 3D faces. */
function shadeColor(hex: string, amount = 0.18): string {
  const h = hex.replace('#', '');
  if (h.length !== 6) return hex;
  const r = Math.max(0, Math.round(Number.parseInt(h.slice(0, 2), 16) * (1 - amount)));
  const g = Math.max(0, Math.round(Number.parseInt(h.slice(2, 4), 16) * (1 - amount)));
  const b = Math.max(0, Math.round(Number.parseInt(h.slice(4, 6), 16) * (1 - amount)));
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

function lightenColor(hex: string, amount = 0.28): string {
  const h = hex.replace('#', '');
  if (h.length !== 6) return hex;
  const r = Math.min(
    255,
    Math.round(
      Number.parseInt(h.slice(0, 2), 16) + (255 - Number.parseInt(h.slice(0, 2), 16)) * amount,
    ),
  );
  const g = Math.min(
    255,
    Math.round(
      Number.parseInt(h.slice(2, 4), 16) + (255 - Number.parseInt(h.slice(2, 4), 16)) * amount,
    ),
  );
  const b = Math.min(
    255,
    Math.round(
      Number.parseInt(h.slice(4, 6), 16) + (255 - Number.parseInt(h.slice(4, 6), 16)) * amount,
    ),
  );
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

/**
 * Marker identity helpers. Silhouettes live in vehicle-icons.ts.
 */
function markerUid(id?: string): string {
  const raw = (id ?? 'm').replace(/[^a-zA-Z0-9]/g, '');
  return `fv${raw.slice(0, 32) || 'm'}`;
}

/**
 * Status-colored navigation puck: circle + dart (heading = rotation).
 * Fill/stroke use the vehicle status color so state and direction are both readable.
 */
function navigationMarkerSvg(
  color: string,
  heading: number,
  selected: boolean,
  _uid: string,
  alarm: string,
): string {
  const ring = selected ? 3.1 : 2.6;
  const halo = selected
    ? `<circle cx="24" cy="24" r="21.2" fill="none" stroke="#F8FAFC" stroke-width="2.2"/>`
    : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 48 48" overflow="visible">
      <ellipse cx="24" cy="43" rx="8" ry="2.6" fill="#0F172A" opacity="0.28"/>
      <g transform="rotate(${heading} 24 24)">
        <circle cx="24" cy="24" r="18.6" fill="none" stroke="${color}" stroke-width="${ring}"/>
        ${halo}
        <path d="M24 8.2 L36.6 35.6 L24 29.4 L11.4 35.6 Z"
          fill="${color}" stroke="#FFFFFF" stroke-width="1.1" stroke-linejoin="round"/>
      </g>
      ${alarm}
    </svg>`;
}

/**
 * Top-down vehicle marker — rotates with map heading (0° = north).
 * Ground shadow and alarm pip stay screen-aligned (outside the rotate group)
 * so the GPS anchor at the marker center does not shift. No SVG filters:
 * `feDropShadow` clips rotated bodies into a circular blob.
 */
export function vehicleMarkerSvg(
  type: VehicleType | undefined,
  color: string,
  opts: {
    heading?: number | null;
    selected?: boolean;
    id?: string;
    alarm?: boolean;
    style?: MapMarkerStyle;
  } = {},
): string {
  const heading = markerHeading(opts.heading, 0);
  const selected = Boolean(opts.selected);
  const uid = markerUid(opts.id);
  const alarm = opts.alarm
    ? opts.style === 'navigation'
      ? `<circle cx="38" cy="10" r="4.2" fill="${mapAccents.vehicleOverspeed}" stroke="#FFFFFF" stroke-width="1.5"/>
       <circle cx="38" cy="10" r="1.7" fill="#FFFFFF"/>`
      : `<circle cx="50" cy="12" r="5.2" fill="${mapAccents.vehicleOverspeed}" stroke="#FFFFFF" stroke-width="1.6"/>
       <circle cx="50" cy="12" r="2.1" fill="#FFFFFF"/>`
    : '';

  if (opts.style === 'navigation') {
    return navigationMarkerSvg(color, heading, selected, uid, alarm);
  }

  const size = 64;
  const dark = shadeColor(color, 0.38);
  const light = lightenColor(color, 0.16);
  const kind = getVehicleIcon({ type, label: '' });
  const body = vehicleBodySvg(kind, uid, selected);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64" overflow="visible">
      <defs>
        <linearGradient id="${uid}-body" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="${shadeColor(color, 0.5)}"/>
          <stop offset="18%" stop-color="${dark}"/>
          <stop offset="36%" stop-color="${lightenColor(color, 0.24)}"/>
          <stop offset="48%" stop-color="${light}"/>
          <stop offset="64%" stop-color="${color}"/>
          <stop offset="100%" stop-color="${shadeColor(color, 0.44)}"/>
        </linearGradient>
        <linearGradient id="${uid}-roof" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="${shadeColor(color, 0.12)}"/>
          <stop offset="100%" stop-color="${shadeColor(color, 0.38)}"/>
        </linearGradient>
        <linearGradient id="${uid}-hood" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="${lightenColor(color, 0.14)}"/>
          <stop offset="100%" stop-color="${shadeColor(color, 0.22)}"/>
        </linearGradient>
        <linearGradient id="${uid}-glass" x1="12%" y1="0%" x2="88%" y2="100%">
          <stop offset="0%" stop-color="#64748B"/>
          <stop offset="28%" stop-color="#334155"/>
          <stop offset="100%" stop-color="#0F172A"/>
        </linearGradient>
      </defs>
      <ellipse cx="32" cy="58.5" rx="10" ry="3.2" fill="#0F172A" opacity="0.32"/>
      <g transform="rotate(${heading} 32 32)">
        ${body}
      </g>
      ${alarm}
    </svg>`;
}

/** Paint the vehicle into a MapLibre marker element (inline SVG, not `<img>`). */
export function paintVehicleMarker(
  el: HTMLElement,
  type: VehicleType | undefined,
  color: string,
  opts: {
    heading?: number | null;
    selected?: boolean;
    id?: string;
    alarm?: boolean;
    style?: MapMarkerStyle;
  } = {},
): void {
  const prev = Number.parseFloat(el.dataset.heading ?? '');
  const heading = markerHeading(opts.heading, Number.isFinite(prev) ? prev : 0);
  if (typeof opts.heading === 'number' && Number.isFinite(opts.heading)) {
    el.dataset.heading = String(heading);
  }
  el.innerHTML = vehicleMarkerSvg(type, color, { ...opts, heading });
  el.classList.toggle('is-selected', Boolean(opts.selected));
  el.classList.toggle('is-alarm', Boolean(opts.alarm));
  el.classList.toggle('is-nav', opts.style === 'navigation');
}

export function vehicleMarkerDataUrl(
  type: VehicleType | undefined,
  color: string,
  opts: { heading?: number; selected?: boolean; id?: string; style?: MapMarkerStyle } = {},
): string {
  return svgDataUrl(vehicleMarkerSvg(type, color, opts));
}

/** Circular dot marker, white-ringed — legacy default (clusters / fallbacks). */
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

/** Vehicle on a track / replay head — same chrome as the live fleet map. */
export function headingArrowDataUrl(
  color: string,
  heading: number,
  type: VehicleType | undefined = 'car',
  style: MapMarkerStyle = 'vehicle',
): string {
  return vehicleMarkerDataUrl(type, color, { heading, style });
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
