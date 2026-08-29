/**
 * Marker rendering helpers for the fleet map.
 *
 * Extracted from the dashboard mini-map so the full Map dashboard shares the
 * same status→color mapping and SVG data-URL construction. All markers are
 * inline SVG data-URLs (no external assets) colored from the semantic palette
 * (UI_UX_Design.md §0.2 mapAccents). Silhouettes are orthographic top-down
 * (flat fleet-vector icon set, top-down), not isometric toys.
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
 * Orthographic top-down bodies (64×64, nose = north).
 *
 * Visual language: flat fleet-vector clipart (the same family as typical
 * “cars & trucks from above” sets — rounded hull, white sticker stroke,
 * steel glass, hubbed wheels). Paths are original; Vecteezy files are not
 * vendored (separate license).
 */
function vehicleBody(type: VehicleType, uid: string, selected: boolean): string {
  const paint = `url(#${uid}-body)`;
  const roof = `url(#${uid}-roof)`;
  const hood = `url(#${uid}-hood)`;
  const glass = '#243044';
  const glassLite = '#4B6280';
  const ink = '#0B0F19';
  const hullStroke = selected ? '#F8FAFC' : '#FFFFFF';
  const hullW = selected ? 2.4 : 1.9;
  const hull = `fill="${paint}" stroke="${hullStroke}" stroke-width="${hullW}" paint-order="stroke fill" stroke-linejoin="round"`;
  const wheel = (x: number, y: number, w = 4.2, h = 9.2) =>
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="1.3" fill="${ink}"/>
     <rect x="${x + 1}" y="${y + 2.4}" width="${w - 2}" height="${h - 4.8}" rx="0.7" fill="#64748B"/>`;
  const lamp = (x: number, y: number, w: number, fill: string) =>
    `<rect x="${x}" y="${y}" width="${w}" height="1.8" rx="0.7" fill="${fill}"/>`;
  const mirror = (x: number, y: number) =>
    `<rect x="${x}" y="${y}" width="3.4" height="2.2" rx="0.7" fill="${ink}" stroke="#FFFFFF" stroke-width="0.6"/>`;

  switch (type) {
    case 'truck':
      return `
        ${wheel(16.2, 13.4, 3.8, 8)}
        ${wheel(44, 13.4, 3.8, 8)}
        ${wheel(15.6, 36.8, 4.2, 9)}
        ${wheel(44.2, 36.8, 4.2, 9)}
        ${wheel(15.6, 47.6, 4.2, 9)}
        ${wheel(44.2, 47.6, 4.2, 9)}
        <rect x="19.2" y="22" width="25.6" height="34.6" rx="1.8" ${hull}/>
        <rect x="21" y="24.2" width="22" height="28.8" rx="1" fill="${roof}"/>
        <path d="M32 24.6 V52.6" stroke="#FFFFFF" stroke-width="0.7" opacity="0.35"/>
        <rect x="20.4" y="5.2" width="23.2" height="18.2" rx="2.4" ${hull}/>
        <path d="M23.6 6.8 H40.4 L38.6 15.6 H25.4 Z" fill="${glass}"/>
        <path d="M25.2 8 H38.8" stroke="${glassLite}" stroke-width="1.1" opacity="0.55"/>
        ${mirror(16.8, 16.2)}${mirror(43.8, 16.2)}
        ${lamp(23.4, 5.5, 5.4, '#FFF7ED')}${lamp(35.2, 5.5, 5.4, '#FFF7ED')}
        ${lamp(22.8, 54.8, 5.8, '#DC2626')}${lamp(35.4, 54.8, 5.8, '#DC2626')}`;

    case 'van':
      return `
        ${wheel(16.4, 17.6)}
        ${wheel(43.4, 17.6)}
        ${wheel(16.4, 43.2)}
        ${wheel(43.4, 43.2)}
        <rect x="19.8" y="5.4" width="24.4" height="21.2" rx="2.6" ${hull}/>
        <path d="M23.2 6.8 H40.8 L38.8 16.8 H25.2 Z" fill="${glass}"/>
        <path d="M25 8.1 H39" stroke="${glassLite}" stroke-width="1.1" opacity="0.55"/>
        <rect x="18.6" y="25.4" width="26.8" height="29.4" rx="1.6" ${hull}/>
        <rect x="21.2" y="28" width="21.6" height="23.6" rx="0.8" fill="${ink}" opacity="0.32"/>
        <path d="M20.6 26.8 H43.4 M20.6 52.8 H43.4" stroke="#FFFFFF" stroke-width="1.05" opacity="0.45"/>
        ${mirror(16.2, 19.4)}${mirror(44.4, 19.4)}
        ${lamp(23.2, 5.7, 5.6, '#FFF7ED')}${lamp(35.2, 5.7, 5.6, '#FFF7ED')}
        ${lamp(22.8, 53.2, 5.8, '#DC2626')}${lamp(35.4, 53.2, 5.8, '#DC2626')}`;

    case 'bus':
      return `
        ${wheel(16.2, 15.6, 4, 9)}
        ${wheel(43.8, 15.6, 4, 9)}
        ${wheel(16.2, 42.8, 4, 9)}
        ${wheel(43.8, 42.8, 4, 9)}
        <rect x="18.6" y="4.8" width="26.8" height="54.4" rx="3.2" ${hull}/>
        <path d="M22.2 6.4 H41.8 L40.2 15 H23.8 Z" fill="${glass}"/>
        <rect x="22" y="16.6" width="20" height="33.2" rx="1.1" fill="${roof}"/>
        <path d="M23.6 20.2 H40.4 M23.6 26.6 H40.4 M23.6 33 H40.4 M23.6 39.4 H40.4 M23.6 45.8 H40.4"
          stroke="${glassLite}" stroke-width="1.35" opacity="0.7"/>
        ${lamp(23, 5.2, 6, '#FFF7ED')}${lamp(35, 5.2, 6, '#FFF7ED')}
        ${lamp(22.8, 57.2, 6, '#DC2626')}${lamp(35.2, 57.2, 6, '#DC2626')}`;

    default:
      return `
        ${wheel(17.8, 19.4)}
        ${wheel(42, 19.4)}
        ${wheel(17.8, 40.8)}
        ${wheel(42, 40.8)}
        <path d="M24.8 6.4 C21.6 6.6 19.2 10 18.6 14.8 L17.6 22.2 C16.8 25 16.6 28 16.6 32
          L16.6 42.6 C16.6 49.2 18.8 53.8 23 56.2 C26.8 58.4 37.2 58.4 41 56.2
          C45.2 53.8 47.4 49.2 47.4 42.6 L47.4 32 C47.4 28 47.2 25 46.4 22.2 L45.4 14.8
          C44.8 10 42.4 6.6 39.2 6.4 C35 5.8 29 5.8 24.8 6.4 Z" ${hull}/>
        <path d="M23.8 8.6 H40.2 L37.8 18.2 H26.2 Z" fill="${hood}"/>
        <path d="M25.8 18.8 H38.2 L36.4 28.6 H27.6 Z" fill="${glass}"/>
        <path d="M27 20 H37" stroke="${glassLite}" stroke-width="1" opacity="0.5"/>
        <rect x="26.4" y="29.2" width="11.2" height="11.6" rx="1.4" fill="${roof}"/>
        <path d="M27.2 41.4 L36.8 41.4 L38.6 49.4 H25.4 Z" fill="${glass}" opacity="0.92"/>
        ${mirror(15.4, 20.8)}${mirror(45.2, 20.8)}
        ${lamp(22.8, 6.6, 5.4, '#FFF7ED')}${lamp(35.8, 6.6, 5.4, '#FFF7ED')}
        ${lamp(23.2, 54.8, 5.4, '#DC2626')}${lamp(35.4, 54.8, 5.4, '#DC2626')}`;
  }
}

function markerUid(id?: string): string {
  const raw = (id ?? 'm').replace(/[^a-zA-Z0-9]/g, '');
  return `fv${raw.slice(0, 32) || 'm'}`;
}

/**
 * Top-down vehicle marker — rotates with map heading (0° = north).
 * Ground shadow stays screen-aligned (outside the rotate group). No SVG
 * filters: `feDropShadow` clips rotated bodies into a circular blob.
 */
export function vehicleMarkerSvg(
  type: VehicleType | undefined,
  color: string,
  opts: { heading?: number; selected?: boolean; id?: string } = {},
): string {
  const heading = Number.isFinite(opts.heading) ? (opts.heading as number) : 0;
  const selected = Boolean(opts.selected);
  const size = 56;
  const uid = markerUid(opts.id);
  const dark = shadeColor(color, 0.38);
  const light = lightenColor(color, 0.16);
  const body = vehicleBody(type ?? 'car', uid, selected);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64" overflow="visible">
      <defs>
        <linearGradient id="${uid}-body" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="${dark}"/>
          <stop offset="38%" stop-color="${color}"/>
          <stop offset="62%" stop-color="${light}"/>
          <stop offset="100%" stop-color="${dark}"/>
        </linearGradient>
        <linearGradient id="${uid}-roof" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="${shadeColor(color, 0.16)}"/>
          <stop offset="100%" stop-color="${shadeColor(color, 0.34)}"/>
        </linearGradient>
        <linearGradient id="${uid}-hood" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="${lightenColor(color, 0.1)}"/>
          <stop offset="100%" stop-color="${shadeColor(color, 0.2)}"/>
        </linearGradient>
      </defs>
      <ellipse cx="32" cy="58.5" rx="10" ry="3.2" fill="#0F172A" opacity="0.32"/>
      <g transform="rotate(${heading} 32 32)">
        ${body}
      </g>
    </svg>`;
}

/** Paint the vehicle into a MapLibre marker element (inline SVG, not `<img>`). */
export function paintVehicleMarker(
  el: HTMLElement,
  type: VehicleType | undefined,
  color: string,
  opts: { heading?: number; selected?: boolean; id?: string } = {},
): void {
  const size = 56;
  el.innerHTML = vehicleMarkerSvg(type, color, opts);
  el.style.width = `${size}px`;
  el.style.height = `${size}px`;
}

export function vehicleMarkerDataUrl(
  type: VehicleType | undefined,
  color: string,
  opts: { heading?: number; selected?: boolean; id?: string } = {},
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

/** Vehicle on a track / replay head — same body as the live fleet map. */
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
