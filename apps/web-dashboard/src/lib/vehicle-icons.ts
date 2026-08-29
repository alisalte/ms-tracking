/**
 * Central vehicle-icon catalog for the tracking map.
 *
 * vehicle → resolveVehicleType / getVehicleIcon → SVG body → paintVehicleMarker
 *
 * Silhouettes live here (and as preview files under `src/assets/vehicle-icons/`)
 * so FleetMap, the dashboard preview, and trip replay share one mapping.
 * Status color and heading are applied by the painter — never baked into
 * per-status asset files.
 */
import type { VehicleType } from '@/types/fleet.types';

export const VEHICLE_TYPES = [
  'car',
  'truck',
  'crane',
  'bus',
  'van',
  'pickup',
  'trailer',
  'motorcycle',
  'excavator',
  'unknown',
] as const satisfies readonly VehicleType[];

const TYPE_SET = new Set<string>(VEHICLE_TYPES);

/** Normalize a wire/registry string to a known body type, or null. */
export function normalizeVehicleType(raw: string | null | undefined): VehicleType | null {
  if (!raw) return null;
  const key = raw
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  if (TYPE_SET.has(key)) return key as VehicleType;
  if (key === 'heavy' || key === 'heavy_equipment' || key === 'heavyequipment') return 'truck';
  if (key === 'crane_air_lifter' || key === 'air_lifter' || key === 'mobile_crane') return 'crane';
  if (key === 'motorbike' || key === 'bike') return 'motorcycle';
  if (key === 'lorry' || key === 'semi') return 'truck';
  if (key === 'minibus' || key === 'coach') return 'bus';
  if (key === 'suv' || key === 'sedan') return 'car';
  return null;
}

/**
 * Infer body type from registry name / label when the API has no `vehicleType`.
 * Seeded names bake Persian types into `name` (e.g. "وانت نیسان …", "خاور …").
 */
export function inferVehicleType(text: string | null | undefined): VehicleType {
  const s = (text ?? '').toLowerCase();
  if (!s.trim()) return 'unknown';
  if (/جرثقیل|crane|لیفت[ر]? هوایی|air[\s_-]?lifter/.test(s)) return 'crane';
  if (/بیل مکانیکی|excavator|دروگر|لودر|loader\b/.test(s)) return 'excavator';
  if (/موتورسیکلت|موتور[\s\u200c]*سیکلت|\bmotorcycle\b|\bmotorbike\b|\bbike\b/.test(s)) {
    return 'motorcycle';
  }
  if (/تریلی|تریلر|trailer|semi[\s_-]?trailer/.test(s)) return 'trailer';
  if (/اتوبوس|مینی[\s\u200c]*بوس|minibus|bus\b|journey|novo/.test(s)) return 'bus';
  if (
    /خاور|آکتروس|actros|ولوو|volvo|\bfh\b|\bfm\b|بنز|کامیون(?!ت)|سنگین|truck|isuzu npr|isuzu nqr|\bnpr\b|\bnqr\b/.test(
      s,
    )
  ) {
    return 'truck';
  }
  if (/وانت|پیکاپ|pickup|zamyad|نیسان|nissan/.test(s)) return 'pickup';
  if (/کامیونت|فوتون|foton|van\b|کاروان|caravan/.test(s)) return 'van';
  if (/سواری|پژو|peugeot|sedan|car\b|۲۰۶|206|سمند|دنا/.test(s)) return 'car';
  return 'unknown';
}

export interface VehicleIconInput {
  type?: string | null;
  category?: string | null;
  deviceType?: string | null;
  label?: string | null;
  name?: string | null;
  plate?: string | null;
}

/**
 * Resolve the silhouette for a vehicle. Priority:
 * 1. explicit `type` (registry / map row)
 * 2. `category`
 * 3. `deviceType` (only if it is a body type, not a protocol)
 * 4. inferred from name + label + plate
 * 5. `unknown`
 */
export function resolveVehicleType(input: VehicleIconInput): VehicleType {
  return (
    normalizeVehicleType(input.type) ??
    normalizeVehicleType(input.category) ??
    normalizeVehicleType(input.deviceType) ??
    inferVehicleType([input.name, input.label, input.plate].filter(Boolean).join(' '))
  );
}

/** Convenience: MapVehicle (and similar) → catalog key. */
export function getVehicleIcon(vehicle: VehicleIconInput): VehicleType {
  return resolveVehicleType(vehicle);
}

/**
 * Orthographic top-down bodies (64×64, nose = north).
 * `paint` is a gradient url from the painter so one body serves every status.
 */
export function vehicleBodySvg(type: VehicleType, uid: string, selected: boolean): string {
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
  const track = (x: number, y: number, h: number) =>
    `<rect x="${x}" y="${y}" width="5.2" height="${h}" rx="1.6" fill="${ink}"/>
     <path d="M${x + 1} ${y + 4} H${x + 4.2} M${x + 1} ${y + 10} H${x + 4.2} M${x + 1} ${y + 16} H${x + 4.2} M${x + 1} ${y + 22} H${x + 4.2}" stroke="#64748B" stroke-width="0.8"/>`;

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

    case 'trailer':
      return `
        ${wheel(16.4, 10.8, 3.6, 7.4)}
        ${wheel(44, 10.8, 3.6, 7.4)}
        ${wheel(15.6, 32, 4.2, 8.6)}
        ${wheel(44.2, 32, 4.2, 8.6)}
        ${wheel(15.6, 43.2, 4.2, 8.6)}
        ${wheel(44.2, 43.2, 4.2, 8.6)}
        ${wheel(15.6, 51.6, 4.2, 8.6)}
        ${wheel(44.2, 51.6, 4.2, 8.6)}
        <rect x="20.6" y="4.6" width="22.8" height="16.4" rx="2.2" ${hull}/>
        <path d="M23.6 6 H40.4 L38.8 14.2 H25.2 Z" fill="${glass}"/>
        <rect x="30.6" y="20.2" width="2.8" height="4.4" rx="0.6" fill="${ink}"/>
        <rect x="18.8" y="24.2" width="26.4" height="35.2" rx="1.6" ${hull}/>
        <rect x="21" y="26.4" width="22" height="30.4" rx="0.8" fill="${roof}"/>
        <path d="M32 26.8 V56.2" stroke="#FFFFFF" stroke-width="0.7" opacity="0.35"/>
        ${mirror(16.8, 14.4)}${mirror(43.8, 14.4)}
        ${lamp(23.4, 4.9, 5.2, '#FFF7ED')}${lamp(35.4, 4.9, 5.2, '#FFF7ED')}
        ${lamp(22.6, 57.6, 5.8, '#DC2626')}${lamp(35.6, 57.6, 5.8, '#DC2626')}`;

    case 'crane':
      return `
        ${wheel(16.4, 28.4, 3.8, 8)}
        ${wheel(43.8, 28.4, 3.8, 8)}
        ${wheel(15.8, 42.2, 4.2, 9)}
        ${wheel(44, 42.2, 4.2, 9)}
        <rect x="20.2" y="22.4" width="23.6" height="17.6" rx="2.2" ${hull}/>
        <path d="M23.4 24 H40.6 L39 32.4 H25 Z" fill="${glass}"/>
        <rect x="19.4" y="38.4" width="25.2" height="17.2" rx="1.6" ${hull}/>
        <rect x="21.4" y="40.2" width="21.2" height="13.2" rx="0.8" fill="${roof}"/>
        ${mirror(16.6, 32)}${mirror(43.8, 32)}
        ${lamp(23.6, 22.7, 5.2, '#FFF7ED')}${lamp(35.2, 22.7, 5.2, '#FFF7ED')}
        ${lamp(22.8, 53.8, 5.6, '#DC2626')}${lamp(35.6, 53.8, 5.6, '#DC2626')}
        <rect x="30.2" y="6.4" width="3.6" height="17.2" rx="1.2" ${hull}/>
        <path d="M24.4 7.2 L39.6 7.2 L38.2 12.6 L25.8 12.6 Z" fill="${hood}"/>
        <path d="M31.2 6.4 L48.6 18.8 L46.8 21.2 L29.8 9.2 Z" fill="${paint}" stroke="${hullStroke}" stroke-width="1.4" stroke-linejoin="round"/>
        <circle cx="47.4" cy="20.4" r="2.1" fill="${ink}" stroke="${hullStroke}" stroke-width="0.8"/>`;

    case 'excavator':
      return `
        ${track(13.6, 22.4, 32.4)}
        ${track(45.2, 22.4, 32.4)}
        <rect x="19.6" y="28.8" width="24.8" height="22.4" rx="2.4" ${hull}/>
        <rect x="22.4" y="31.4" width="19.2" height="16.4" rx="1.2" fill="${roof}"/>
        <rect x="23.2" y="18.6" width="17.6" height="12.4" rx="2" ${hull}/>
        <path d="M25.6 19.8 H38.4 L37.2 26.6 H26.8 Z" fill="${glass}"/>
        <path d="M30.4 18.4 L18.2 6.6 L21.4 4.8 L34.2 17.2 Z" fill="${paint}" stroke="${hullStroke}" stroke-width="1.5" stroke-linejoin="round"/>
        <path d="M19.4 6.2 L11.6 14.8 L14.6 16.6 L22.2 8.2 Z" fill="${hood}" stroke="${hullStroke}" stroke-width="1.1"/>
        <rect x="10.2" y="14.2" width="6.4" height="3.2" rx="0.8" fill="${ink}"/>
        ${lamp(24.8, 19, 5, '#FFF7ED')}${lamp(34.2, 19, 5, '#FFF7ED')}`;

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

    case 'pickup':
      return `
        ${wheel(16.6, 16.8)}
        ${wheel(43.2, 16.8)}
        ${wheel(16.6, 42.6)}
        ${wheel(43.2, 42.6)}
        <rect x="20.2" y="5.6" width="23.6" height="22.4" rx="2.6" ${hull}/>
        <path d="M23.4 7.2 H40.6 L38.8 17.4 H25.2 Z" fill="${glass}"/>
        <path d="M25.2 8.6 H38.8" stroke="${glassLite}" stroke-width="1.1" opacity="0.55"/>
        <rect x="19" y="27.2" width="26" height="27.6" rx="1.4" ${hull}/>
        <rect x="21.4" y="29.4" width="21.2" height="22.4" rx="0.7" fill="none" stroke="#FFFFFF" stroke-width="1.05" opacity="0.55"/>
        <path d="M21.6 40.6 H42.4" stroke="#FFFFFF" stroke-width="0.8" opacity="0.4"/>
        ${mirror(16.4, 18.6)}${mirror(44.2, 18.6)}
        ${lamp(23.4, 5.9, 5.4, '#FFF7ED')}${lamp(35.2, 5.9, 5.4, '#FFF7ED')}
        ${lamp(22.8, 52.8, 5.6, '#DC2626')}${lamp(35.6, 52.8, 5.6, '#DC2626')}`;

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

    case 'motorcycle':
      return `
        <ellipse cx="32" cy="16.4" rx="4.6" ry="7.2" fill="${ink}"/>
        <ellipse cx="32" cy="16.4" rx="2.4" ry="4" fill="#64748B"/>
        <ellipse cx="32" cy="48.6" rx="5.2" ry="8" fill="${ink}"/>
        <ellipse cx="32" cy="48.6" rx="2.6" ry="4.4" fill="#64748B"/>
        <path d="M28.6 22.2 C27.4 24.6 26.8 28.4 26.8 32.6 C26.8 37.4 27.6 42.2 29.2 44.8
          L34.8 44.8 C36.4 42.2 37.2 37.4 37.2 32.6 C37.2 28.4 36.6 24.6 35.4 22.2 Z" ${hull}/>
        <rect x="29.6" y="24.4" width="4.8" height="8.2" rx="1.1" fill="${glass}"/>
        <rect x="29.2" y="18.8" width="5.6" height="3.4" rx="1.2" fill="${ink}"/>
        <path d="M24.8 21.2 H39.2" stroke="${ink}" stroke-width="1.8" stroke-linecap="round"/>
        ${lamp(29.6, 12.2, 4.8, '#FFF7ED')}
        ${lamp(29.8, 54.6, 4.4, '#DC2626')}`;

    case 'car':
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

    default:
      return `
        ${wheel(18.4, 20.2, 4, 8.6)}
        ${wheel(41.6, 20.2, 4, 8.6)}
        ${wheel(18.4, 40.6, 4, 8.6)}
        ${wheel(41.6, 40.6, 4, 8.6)}
        <rect x="21.2" y="8.4" width="21.6" height="47.2" rx="6.4" ${hull}/>
        <rect x="24.4" y="12.2" width="15.2" height="10.4" rx="2" fill="${glass}"/>
        <rect x="25.2" y="26.4" width="13.6" height="16.8" rx="1.4" fill="${roof}"/>
        ${lamp(24.6, 8.8, 5, '#FFF7ED')}${lamp(34.4, 8.8, 5, '#FFF7ED')}
        ${lamp(24.6, 53.6, 5, '#DC2626')}${lamp(34.4, 53.6, 5, '#DC2626')}`;
  }
}
