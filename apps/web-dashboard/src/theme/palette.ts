/**
 * FleetVision Design System — Color palette (v3 — Limitless-inspired).
 *
 * Built on the Limitless Material-derived system palette (primary #2196F3,
 * status hues straight from Google's Material set) so the UI reads
 * "Limitless", while FleetVision's identity is carried by the brand mark and
 * domain UX — not by recoloring system tokens. See
 * docs/frontend-theme-migration.md.
 *
 * The signature Limitless silhouette (dark slate sidebar in both modes) lives
 * in `sidebar` below; navbar + content adapt to the active color mode.
 */

/**
 * Neutral ramp — Limitless leans on Bootstrap-4 neutrals for surfaces.
 * Body text is #333 (not pure black), muted text is #777.
 */
export const neutral = {
  0: '#FFFFFF',
  25: '#FAFAFA',
  50: '#F5F5F5',
  100: '#F0F0F0',
  200: '#EEEEEE',
  300: '#E5E5E5',
  400: '#DDDDDD',
  500: '#B7B7B7',
  600: '#999999',
  700: '#777777',
  800: '#555555',
  900: '#333333',
  950: '#1A1A1A',
} as const;

/**
 * Primary — Limitless blue (Material Blue 500). Hover/active use the
 * surrounding Material shades so every state is consistent.
 */
export const primary = {
  main: '#2196F3',
  light: '#64B5F6',
  lighter: '#BBDEFB',
  dark: '#1976D2',
  darker: '#1565C0',
  hover: '#1E88E5',
  pressed: '#1565C0',
  /** Soft tinted background used for active nav rows, alpha chips, etc. */
  tint: 'rgba(33, 150, 243, 0.10)',
  /** Brand gradient kept for the FleetVision logo mark only. */
  brandGradient: 'linear-gradient(135deg, #2196F3 0%, #3F51B5 100%)',
  /** Alias for legacy call sites. */
  gradient: 'linear-gradient(135deg, #2196F3 0%, #3F51B5 100%)',
} as const;

/**
 * Status colors — Material palette at the 500 shade, matching Limitless.
 * Warning is Limitless's deep-orange (#FF5722), not amber.
 *
 * `green`/`amber`/`red`/`blue` aliases keep legacy call sites working during
 * the v3 redesign; they map to the Material status hues above.
 */
export const status = {
  success: '#4CAF50',
  successLight: '#81C784',
  successBg: 'rgba(76, 175, 80, 0.12)',
  green: '#4CAF50',

  warning: '#FF5722',
  warningLight: '#FF8A65',
  warningBg: 'rgba(255, 87, 34, 0.12)',
  amber: '#FF9800',

  danger: '#F44336',
  dangerLight: '#E57373',
  dangerBg: 'rgba(244, 67, 54, 0.12)',
  red: '#F44336',

  info: '#00BCD4',
  infoLight: '#4DD0E1',
  infoBg: 'rgba(0, 188, 212, 0.12)',
  blue: '#2196F3',

  indigo: '#3F51B5',
  purple: '#A855F7',
  slate: '#607D8B',
} as const;

/**
 * The signature Limitless dark slate sidebar. Kept constant across light/dark
 * modes so the shell always reads as Limitless Layout 1.
 */
export const sidebar = {
  /** Base background — Material Blue Grey 900 (Limitless default). */
  bg: '#263238',
  /** Group-header strip — slightly darker, like Limitless's rgba(0,0,0,0.1). */
  groupBg: 'rgba(0, 0, 0, 0.18)',
  /** Hover/active tint for nav rows. */
  hover: 'rgba(255, 255, 255, 0.06)',
  active: 'rgba(255, 255, 255, 0.10)',
  /** Active left/right accent bar. */
  accent: '#2196F3',
  /** Borders within the dark sidebar. */
  border: 'rgba(255, 255, 255, 0.08)',
  /** Inactive nav text. */
  text: 'rgba(255, 255, 255, 0.75)',
  /** Active/strong nav text. */
  textStrong: '#FFFFFF',
  /** Group header label text. */
  textMuted: 'rgba(255, 255, 255, 0.45)',
} as const;

/** Light-mode surfaces — Limitless's near-white cards on #F5F5F5 pages. */
export const lightSurface = {
  bg: '#F5F5F5',
  paper: '#FFFFFF',
  elevated: '#FFFFFF',
  hover: '#FAFAFA',
  tableHead: '#FAFAFA',
  border: '#EEEEEE',
  borderStrong: '#DDDDDD',
  divider: '#EEEEEE',
} as const;

/** Dark-mode surfaces — layered slate (Limitless dark theme family). */
export const darkSurface = {
  bg: '#1F2730',
  paper: '#2A333D',
  elevated: '#323D48',
  hover: '#36424E',
  tableHead: '#2F3942',
  border: 'rgba(255, 255, 255, 0.08)',
  borderStrong: 'rgba(255, 255, 255, 0.14)',
  divider: 'rgba(255, 255, 255, 0.08)',
} as const;

/** Map marker / route accents (kept stable across the redesign). */
export const mapAccents = {
  vehicleActive: '#4CAF50',
  vehicleIdle: '#FFC107',
  vehicleOverspeed: '#F44336',
  vehicleOffline: '#9E9E9E',
  geofence: '#3F51B5',
  selectedRoute: '#00BCD4',
} as const;

/**
 * Shadows — Limitless is near-flat by default. Cards rest on a barely-there
 * 1px shadow; elevation is opt-in for drawers/popovers/dialogs.
 */
export const shadows = {
  card: '0 1px 2px rgba(0,0,0,0.05)',
  cardHover: '0 2px 8px rgba(0,0,0,0.08)',
  raised: '0 1px 3px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.24)',
  elevated: '0 6px 16px rgba(0,0,0,0.12), 0 3px 6px rgba(0,0,0,0.08)',
  sidebar: '0.25rem 0 1rem rgba(0,0,0,0.18)',
  darkCard: '0 1px 2px rgba(0,0,0,0.35)',
  darkElevated: '0 8px 28px rgba(0,0,0,0.45), 0 2px 8px rgba(0,0,0,0.30)',
} as const;

/** Common limit radius for pills, badges, rounded chips. */
export const pillRadius = 100;
