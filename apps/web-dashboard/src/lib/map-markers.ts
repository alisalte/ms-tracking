/**
 * Marker rendering helpers for the fleet map.
 *
 * Extracted from the dashboard mini-map so the full Map dashboard shares the
 * same status→color mapping and SVG data-URL construction. All markers are
 * inline SVG data-URLs (no external assets) colored from the semantic palette
 * (UI_UX_Design.md §0.2 mapAccents).
 *
 * Vehicle body type (سواری / وانت / سنگین / اتوبوس) selects the silhouette;
 * movement status still drives the fill color (§2.4).
 */
import { mapAccents, neutral } from '@/theme/palette';
import type { MapVehicle, VehiclePresence, VehicleType } from '@/types/fleet.types';

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
 * Infer body type from registry name / label when the API has no `vehicleType`.
 * Seeded names bake Persian types into `name` (e.g. "وانت نیسان …", "خاور …").
 */
export function inferVehicleType(text: string | null | undefined): VehicleType {
  const s = (text ?? '').toLowerCase();
  if (/اتوبوس|مینی[\s\u200c]*بوس|minibus|bus\b|journey|novo/.test(s)) return 'bus';
  // Heavy truck before light trucklet (کامیونت → van).
  if (
    /خاور|آکتروس|actros|ولوو|volvo|\bfh\b|\bfm\b|بنز|کامیون(?!ت)|سنگین|truck|isuzu npr|isuzu nqr|\bnpr\b|\bnqr\b/.test(
      s,
    )
  ) {
    return 'truck';
  }
  if (/وانت|کامیونت|فوتون|foton|zamyad|نیسان|nissan|van|pickup|کاروان|caravan/.test(s)) {
    return 'van';
  }
  if (/سواری|پژو|peugeot|sedan|car\b|۲۰۶|206|سمند|دنا/.test(s)) return 'car';
  return 'car';
}

/** Encode a raw SVG string as an `<img>`-ready base64 data URL. */
function svgDataUrl(svg: string): string {
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}

/** Darken / lighten hex for 3D faces. */
function shadeColor(hex: string, amount = 0.18): string {
  const h = hex.replace('#', '');
  if (h.length !== 6) return hex;
  const r = Math.max(0, Math.round(parseInt(h.slice(0, 2), 16) * (1 - amount)));
  const g = Math.max(0, Math.round(parseInt(h.slice(2, 4), 16) * (1 - amount)));
  const b = Math.max(0, Math.round(parseInt(h.slice(4, 6), 16) * (1 - amount)));
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

function lightenColor(hex: string, amount = 0.28): string {
  const h = hex.replace('#', '');
  if (h.length !== 6) return hex;
  const r = Math.min(255, Math.round(parseInt(h.slice(0, 2), 16) + (255 - parseInt(h.slice(0, 2), 16)) * amount));
  const g = Math.min(255, Math.round(parseInt(h.slice(2, 4), 16) + (255 - parseInt(h.slice(2, 4), 16)) * amount));
  const b = Math.min(255, Math.round(parseInt(h.slice(4, 6), 16) + (255 - parseInt(h.slice(4, 6), 16)) * amount));
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

/**
 * Isometric 3D vehicle bodies (48×48, nose = north / −Y).
 * Layered: ground shadow → side extrusion → roof → glass → wheels.
 */
function vehicle3dBody(type: VehicleType, dark: string): string {
  const wheel = '#1E293B';
  const rim = '#64748B';

  const wheelPair = (x1: number, x2: number, y: number) => `
    <ellipse cx="${x1}" cy="${y + 0.8}" rx="2.6" ry="1.5" fill="#0F172A" opacity="0.35"/>
    <ellipse cx="${x2}" cy="${y + 0.8}" rx="2.6" ry="1.5" fill="#0F172A" opacity="0.35"/>
    <circle cx="${x1}" cy="${y}" r="2.3" fill="${wheel}"/>
    <circle cx="${x2}" cy="${y}" r="2.3" fill="${wheel}"/>
    <circle cx="${x1}" cy="${y}" r="1.1" fill="${rim}" opacity="0.55"/>
    <circle cx="${x2}" cy="${y}" r="1.1" fill="${rim}" opacity="0.55"/>`;

  switch (type) {
    case 'truck':
      return `
        <ellipse cx="24" cy="41" rx="14" ry="4.2" fill="#0F172A" opacity="0.2"/>
        <!-- trailer side -->
        <path d="M11 30 L37 30 L37 33 L11 33 Z" fill="${dark}" opacity="0.9"/>
        <!-- trailer top -->
        <path d="M11 19 L37 19 L37 30 L11 30 Z" fill="url(#roof)" stroke="${dark}" stroke-width="0.6"/>
        <path d="M13 21 L35 21" stroke="#FFFFFF" stroke-width="0.7" opacity="0.25"/>
        <!-- cab side -->
        <path d="M11 22 L11 33 L8 33 L8 24 L11 22 Z" fill="${dark}"/>
        <!-- cab top -->
        <path d="M8 14 L11 12 L14 14 L14 22 L8 22 Z" fill="url(#hood)" stroke="${dark}" stroke-width="0.5"/>
        <!-- cab glass -->
        <path d="M9 15.5 L11.5 13.5 L13 15 L13 19 L9 19 Z" fill="url(#glass)" opacity="0.9"/>
        ${wheelPair(10, 13, 33)}
        ${wheelPair(30, 34, 33)}`;

    case 'van':
      return `
        <ellipse cx="24" cy="41" rx="12" ry="4" fill="#0F172A" opacity="0.2"/>
        <!-- cargo side -->
        <path d="M14 28 L36 28 L36 31 L14 31 Z" fill="${dark}" opacity="0.88"/>
        <!-- cargo top -->
        <path d="M14 17 L36 17 L36 28 L14 28 Z" fill="url(#roof)" stroke="${dark}" stroke-width="0.6"/>
        <!-- cab side -->
        <path d="M14 20 L14 31 L10 31 L10 22 L14 20 Z" fill="${dark}"/>
        <!-- cab top -->
        <path d="M10 13 L14 11 L18 13 L18 20 L10 20 Z" fill="url(#hood)" stroke="${dark}" stroke-width="0.5"/>
        <path d="M11.5 14.5 L14 12.8 L16.5 14.5 L16.5 17.5 L11.5 17.5 Z" fill="url(#glass)" opacity="0.88"/>
        ${wheelPair(12, 16, 31)}
        ${wheelPair(30, 34, 31)}`;

    case 'bus':
      return `
        <ellipse cx="24" cy="41" rx="13" ry="4.2" fill="#0F172A" opacity="0.2"/>
        <path d="M12 29 L36 29 L36 32 L12 32 Z" fill="${dark}" opacity="0.88"/>
        <path d="M12 12 L36 12 L36 29 L12 29 Z" fill="url(#roof)" stroke="${dark}" stroke-width="0.6"/>
        <path d="M14 15 L34 15" stroke="#FFFFFF" stroke-width="0.65" opacity="0.22"/>
        <path d="M14 19 L34 19" stroke="#FFFFFF" stroke-width="0.65" opacity="0.18"/>
        <path d="M14 23 L34 23" stroke="#FFFFFF" stroke-width="0.65" opacity="0.14"/>
        <path d="M13 12 L15 10 L33 10 L35 12 L35 14 L13 14 Z" fill="url(#hood)" opacity="0.95"/>
        <path d="M15 10.5 L33 10.5 L32 13 L16 13 Z" fill="url(#glass)" opacity="0.85"/>
        ${wheelPair(15, 18, 32)}
        ${wheelPair(28, 31, 32)}`;

    default:
      // Sedan — compact isometric with hood + cabin + trunk.
      return `
        <ellipse cx="24" cy="40" rx="10.5" ry="3.8" fill="#0F172A" opacity="0.22"/>
        <!-- body side skirt -->
        <path d="M15 29 Q24 31 33 29 L33 31 Q24 33.5 15 31 Z" fill="${dark}" opacity="0.85"/>
        <!-- main body -->
        <path d="M15 18 Q24 14 33 18 L33 29 Q24 31 15 29 Z" fill="url(#roof)" stroke="${dark}" stroke-width="0.65"/>
        <!-- hood (front/north) -->
        <path d="M17 18 Q24 14.5 31 18 L28.5 22 L19.5 22 Z" fill="url(#hood)"/>
        <!-- windshield -->
        <path d="M19 22 Q24 19 29 22 L28 26 L20 26 Z" fill="url(#glass)" opacity="0.92"/>
        <!-- rear deck -->
        <path d="M20 26 L28 26 L27 28.5 L21 28.5 Z" fill="${dark}" opacity="0.55"/>
        <!-- roof shine -->
        <path d="M20 23 Q24 21 28 23" fill="none" stroke="#FFFFFF" stroke-width="1" opacity="0.35"/>
        ${wheelPair(17, 21, 29.5)}
        ${wheelPair(27, 31, 29.5)}`;
  }
}

/**
 * 3D isometric vehicle marker — rotates with map heading (0° = north).
 */
export function vehicleMarkerDataUrl(
  type: VehicleType | undefined,
  color: string,
  opts: { heading?: number; selected?: boolean } = {},
): string {
  const heading = Number.isFinite(opts.heading) ? (opts.heading as number) : 0;
  const selected = Boolean(opts.selected);
  const size = selected ? 48 : 40;
  const cx = 24;
  const cy = 24;
  const dark = shadeColor(color, 0.32);
  const light = lightenColor(color, 0.35);
  const body = vehicle3dBody(type ?? 'car', dark);

  const selectedRing = selected
    ? `<circle cx="${cx}" cy="${cy - 2}" r="20" fill="${color}" opacity="0.14"/>
       <circle cx="${cx}" cy="${cy - 2}" r="17" fill="none" stroke="${color}" stroke-width="2" opacity="0.5"/>`
    : '';

  return svgDataUrl(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 48 48">
      <defs>
        <linearGradient id="roof" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="${light}"/>
          <stop offset="55%" stop-color="${color}"/>
          <stop offset="100%" stop-color="${dark}"/>
        </linearGradient>
        <linearGradient id="hood" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="${lightenColor(color, 0.15)}"/>
          <stop offset="100%" stop-color="${dark}"/>
        </linearGradient>
        <linearGradient id="glass" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#E0F2FE"/>
          <stop offset="100%" stop-color="#7DD3FC"/>
        </linearGradient>
        <filter id="lift" x="-20%" y="-20%" width="140%" height="150%">
          <feDropShadow dx="0" dy="2.5" stdDeviation="2.2" flood-color="#0F172A" flood-opacity="0.35"/>
        </filter>
      </defs>
      ${selectedRing}
      <g filter="url(#lift)" transform="rotate(${heading} ${cx} ${cy - 2})">
        ${body}
      </g>
    </svg>`);
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
