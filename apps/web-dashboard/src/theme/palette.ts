/**
 * FleetVision Design System — Color palette (v6 — TailAdmin-faithful, Phase 2.6).
 *
 * The ONLY raw-color registry in the app. ApexCharts, ECharts, MapLibre, and
 * generated SVG markers import from here; component UI reads the matching
 * Tailwind tokens from `src/styles/tailwind.css` (brand/gray/graydark/semantic/meta
 * families). Never hardcode hex values in components — add or reuse a token.
 *
 * Phase 2.6: legacy v5 exports with no remaining consumers (primary, sidebar,
 * lightSurface, darkSurface, shadows, pillRadius, glass) were removed with the
 * MUI/gradient era they served.
 */

/** Neutral ramp — TailAdmin `gray` family (light). */
export const neutral = {
  0: '#FFFFFF',
  25: '#FCFCFD',
  50: '#F9FAFB',
  100: '#F2F4F7',
  200: '#E4E7EC',
  300: '#D0D5DD',
  400: '#98A2B3',
  500: '#667085',
  600: '#475467',
  700: '#344054',
  800: '#1D2939',
  900: '#101828',
  950: '#0C111D',
} as const;

/** Semantic statuses — the domain status→color registry (charts, maps, timelines). */
export const status = {
  success: '#12B76A',
  successLight: '#36B37E',
  successBg: 'rgba(18, 183, 106, 0.12)',
  green: '#12B76A',

  warning: '#F79009',
  warningLight: '#FDB022',
  warningBg: 'rgba(247, 144, 9, 0.12)',
  amber: '#FDB022',

  danger: '#F04438',
  dangerLight: '#FB7185',
  /** Deep shade for emphasis on dark surfaces (severity "critical" center labels). */
  dangerDeep: '#912018',
  dangerBg: 'rgba(240, 68, 56, 0.12)',
  red: '#F04438',

  info: '#1570EF',
  infoLight: '#2E90FA',
  infoBg: 'rgba(21, 112, 239, 0.12)',
  blue: '#465FFB',

  indigo: '#465FFB',
  purple: '#8B5CF6',
  pink: '#EE46BC',
  teal: '#06B6D4',
  slate: '#667085',
} as const;

/** Map/marker accents — vehicle states, geofences, selected routes. */
export const mapAccents = {
  vehicleActive: '#12B76A',
  vehicleIdle: '#F79009',
  vehicleOverspeed: '#F04438',
  vehicleOffline: '#98A2B3',
  geofence: '#465FFB',
  selectedRoute: '#06B6D4',
} as const;
