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
 * Top-down 3D vehicle bodies (64×64, nose = north / −Y).
 * Reads as a glossy GPS pin at 40px: extrusion, glass, lights, wheels.
 */
function vehicle3dBody(type: VehicleType, dark: string): string {
  const wheel = '#0F172A';
  const rubber = (x: number, y: number, rx = 3.1, ry = 5.2) =>
    `<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="${wheel}"/>
     <ellipse cx="${x}" cy="${y}" rx="${rx * 0.42}" ry="${ry * 0.42}" fill="#94A3B8" opacity="0.45"/>`;

  switch (type) {
    case 'truck':
      return `
        ${rubber(20.5, 18.5, 2.6, 4.2)}
        ${rubber(43.5, 18.5, 2.6, 4.2)}
        ${rubber(20.5, 42, 2.8, 4.6)}
        ${rubber(43.5, 42, 2.8, 4.6)}
        ${rubber(20.5, 50.5, 2.8, 4.6)}
        ${rubber(43.5, 50.5, 2.8, 4.6)}
        <!-- trailer extrusion -->
        <rect x="19" y="24" width="26" height="32" rx="3" fill="${dark}"/>
        <rect x="18" y="23" width="26" height="31" rx="3" fill="url(#body)"/>
        <rect x="20.5" y="26" width="21" height="25" rx="1.6" fill="url(#roof)"/>
        <path d="M22 28 H40" stroke="#FFFFFF" stroke-width="0.7" opacity="0.22"/>
        <path d="M22 33 H40" stroke="#FFFFFF" stroke-width="0.7" opacity="0.16"/>
        <path d="M22 38 H40" stroke="#FFFFFF" stroke-width="0.7" opacity="0.12"/>
        <!-- cab -->
        <rect x="21" y="8" width="22" height="17" rx="5" fill="${dark}"/>
        <rect x="20" y="7" width="22" height="16.5" rx="5" fill="url(#body)"/>
        <path d="M24 9.2 L40 9.2 L37.5 16.5 L26.5 16.5 Z" fill="url(#glass)"/>
        <path d="M27 16.8 H37 V21.5 H27 Z" fill="url(#roof)"/>
        <ellipse cx="24.2" cy="8.6" rx="2.4" ry="1.35" fill="#FEF9C3"/>
        <ellipse cx="39.8" cy="8.6" rx="2.4" ry="1.35" fill="#FEF9C3"/>
        <rect x="23" y="52.2" width="5" height="1.7" rx="0.8" fill="#F87171"/>
        <rect x="36" y="52.2" width="5" height="1.7" rx="0.8" fill="#F87171"/>`;

    case 'van':
      return `
        ${rubber(21, 22)}
        ${rubber(43, 22)}
        ${rubber(21, 46)}
        ${rubber(43, 46)}
        <rect x="20" y="10" width="24" height="44" rx="7" fill="${dark}"/>
        <rect x="19" y="9" width="24" height="43" rx="7" fill="url(#body)"/>
        <path d="M23.5 11.5 L40.5 11.5 L38 22 L26 22 Z" fill="url(#glass)"/>
        <rect x="23.5" y="22.5" width="15" height="24" rx="2" fill="url(#roof)"/>
        <path d="M25 24.5 H37" stroke="#FFFFFF" stroke-width="0.8" opacity="0.28"/>
        <path d="M25 30 H37" stroke="#FFFFFF" stroke-width="0.7" opacity="0.16"/>
        <path d="M26 47 L38 47 L40 51.5 L24 51.5 Z" fill="url(#glass)" opacity="0.55"/>
        <ellipse cx="23.5" cy="11.2" rx="2.3" ry="1.3" fill="#FEF9C3"/>
        <ellipse cx="40.5" cy="11.2" rx="2.3" ry="1.3" fill="#FEF9C3"/>
        <ellipse cx="17.6" cy="23" rx="2.2" ry="1.5" fill="${dark}"/>
        <ellipse cx="46.4" cy="23" rx="2.2" ry="1.5" fill="${dark}"/>
        <rect x="23.5" y="50.6" width="4.6" height="1.6" rx="0.8" fill="#F87171"/>
        <rect x="35.9" y="50.6" width="4.6" height="1.6" rx="0.8" fill="#F87171"/>`;

    case 'bus':
      return `
        ${rubber(21.2, 20, 2.8, 4.8)}
        ${rubber(42.8, 20, 2.8, 4.8)}
        ${rubber(21.2, 46, 2.8, 4.8)}
        ${rubber(42.8, 46, 2.8, 4.8)}
        <rect x="19.5" y="8" width="25" height="48" rx="6" fill="${dark}"/>
        <rect x="18.5" y="7" width="25" height="47" rx="6" fill="url(#body)"/>
        <path d="M22 8.8 L42 8.8 L40 16 L24 16 Z" fill="url(#glass)"/>
        <rect x="22.5" y="17" width="17" height="30" rx="1.4" fill="url(#roof)"/>
        <path d="M24.5 20.5 H37.5 M24.5 26 H37.5 M24.5 31.5 H37.5 M24.5 37 H37.5 M24.5 42.5 H37.5"
          stroke="#FFFFFF" stroke-width="0.7" opacity="0.2"/>
        <path d="M24 47.5 L40 47.5 L42 52 L22 52 Z" fill="url(#glass)" opacity="0.5"/>
        <ellipse cx="23.2" cy="8.4" rx="2.5" ry="1.35" fill="#FEF9C3"/>
        <ellipse cx="40.8" cy="8.4" rx="2.5" ry="1.35" fill="#FEF9C3"/>
        <rect x="22.5" y="52.4" width="5.2" height="1.7" rx="0.8" fill="#F87171"/>
        <rect x="36.3" y="52.4" width="5.2" height="1.7" rx="0.8" fill="#F87171"/>`;

    default:
      return `
        ${rubber(20.8, 24)}
        ${rubber(43.2, 24)}
        ${rubber(20.8, 44.5)}
        ${rubber(43.2, 44.5)}
        <!-- extrusion -->
        <path d="M22 10 C18 12 16.5 18 16.5 26 C16.5 40 18 50 22 54 C26 57 38 57 42 54 C46 50 47.5 40 47.5 26 C47.5 18 46 12 42 10 C38 7.5 26 7.5 22 10 Z" fill="${dark}"/>
        <!-- body -->
        <path d="M22 9 C18.2 11 17 17 17 25 C17 39 18.5 48.5 22.2 52.5 C26 55.5 38 55.5 41.8 52.5 C45.5 48.5 47 39 47 25 C47 17 45.8 11 42 9 C38 6.6 26 6.6 22 9 Z" fill="url(#body)"/>
        <!-- hood -->
        <path d="M23.5 10.2 C26.5 8.6 37.5 8.6 40.5 10.2 L38.6 20.8 L25.4 20.8 Z" fill="url(#hood)"/>
        <!-- windshield -->
        <path d="M25.6 21.2 L38.4 21.2 L36.2 31.2 L27.8 31.2 Z" fill="url(#glass)"/>
        <!-- roof -->
        <rect x="26.6" y="31.4" width="10.8" height="10.2" rx="1.8" fill="url(#roof)"/>
        <path d="M28.2 33.2 Q32 31.6 35.8 33.2" fill="none" stroke="#FFFFFF" stroke-width="1.15" opacity="0.4"/>
        <!-- rear window -->
        <path d="M27.8 41.8 L36.2 41.8 L38.2 49 L25.8 49 Z" fill="url(#glass)" opacity="0.62"/>
        <!-- headlights -->
        <ellipse cx="24.6" cy="10.4" rx="2.55" ry="1.45" fill="#FEF9C3"/>
        <ellipse cx="39.4" cy="10.4" rx="2.55" ry="1.45" fill="#FEF9C3"/>
        <ellipse cx="24.6" cy="10.4" rx="1.15" ry="0.65" fill="#FFFFFF" opacity="0.85"/>
        <ellipse cx="39.4" cy="10.4" rx="1.15" ry="0.65" fill="#FFFFFF" opacity="0.85"/>
        <!-- mirrors -->
        <ellipse cx="16.4" cy="23.5" rx="2.4" ry="1.55" fill="${dark}"/>
        <ellipse cx="47.6" cy="23.5" rx="2.4" ry="1.55" fill="${dark}"/>
        <!-- taillights -->
        <rect x="24" y="51.6" width="5" height="1.8" rx="0.9" fill="#F87171"/>
        <rect x="35" y="51.6" width="5" height="1.8" rx="0.9" fill="#F87171"/>`;
  }
}

/**
 * Top-down 3D vehicle marker — rotates with map heading (0° = north).
 * Ground shadow stays screen-aligned so the body still reads as 3D when turning.
 */
export function vehicleMarkerDataUrl(
  type: VehicleType | undefined,
  color: string,
  opts: { heading?: number; selected?: boolean } = {},
): string {
  const heading = Number.isFinite(opts.heading) ? (opts.heading as number) : 0;
  const selected = Boolean(opts.selected);
  const size = selected ? 56 : 48;
  const dark = shadeColor(color, 0.34);
  const light = lightenColor(color, 0.42);
  const body = vehicle3dBody(type ?? 'car', dark);

  const selectedRing = selected
    ? `<circle cx="32" cy="32" r="30" fill="${color}" opacity="0.12"/>
       <circle cx="32" cy="32" r="27" fill="none" stroke="${color}" stroke-width="2.2" opacity="0.55"/>`
    : '';

  return svgDataUrl(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64">
      <defs>
        <linearGradient id="body" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="${light}"/>
          <stop offset="45%" stop-color="${color}"/>
          <stop offset="100%" stop-color="${dark}"/>
        </linearGradient>
        <linearGradient id="roof" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="${lightenColor(color, 0.22)}"/>
          <stop offset="100%" stop-color="${color}"/>
        </linearGradient>
        <linearGradient id="hood" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="${lightenColor(color, 0.18)}"/>
          <stop offset="100%" stop-color="${shadeColor(color, 0.12)}"/>
        </linearGradient>
        <linearGradient id="glass" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#F0F9FF"/>
          <stop offset="40%" stop-color="#7DD3FC"/>
          <stop offset="100%" stop-color="#0284C7"/>
        </linearGradient>
        <filter id="lift" x="-25%" y="-25%" width="150%" height="160%">
          <feDropShadow dx="0" dy="1.8" stdDeviation="1.6" flood-color="#0F172A" flood-opacity="0.4"/>
        </filter>
      </defs>
      ${selectedRing}
      <g filter="url(#lift)" transform="rotate(${heading} 32 32)">
        <ellipse cx="32" cy="53" rx="13" ry="5" fill="#0F172A" opacity="0.3"/>
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

/** Vehicle on a track / replay head — same 3D body as the live fleet map. */
export function headingArrowDataUrl(color: string, heading: number): string {
  return vehicleMarkerDataUrl('car', color, { heading });
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
