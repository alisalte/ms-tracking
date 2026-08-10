/**
 * FleetVision Design System — Color palette (v4 — Limitless-faithful).
 *
 * Exact Limitless admin template tokens. The UI reads "Limitless" through and
 * through: Material Blue primary, dark slate sidebar, light grey page, 3px
 * radius, near-flat cards. FleetVision identity carried by the brand mark only.
 */

/** Neutral ramp — Limitless uses Bootstrap-4 neutrals. */
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

/** Primary — Limitless Material Blue 500. */
export const primary = {
  main: '#2196F3',
  light: '#64B5F6',
  lighter: '#BBDEFB',
  dark: '#1976D2',
  darker: '#1565C0',
  hover: '#1E88E5',
  pressed: '#1565C0',
  tint: 'rgba(33, 150, 243, 0.10)',
  brandGradient: 'linear-gradient(135deg, #2196F3 0%, #3F51B5 100%)',
  gradient: 'linear-gradient(135deg, #2196F3 0%, #3F51B5 100%)',
} as const;

/** Status colors — Limitless Material palette at the 500 shade. */
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
  purple: '#AB47BC',
  pink: '#E91E63',
  teal: '#009688',
  slate: '#607D8B',
} as const;

/** The signature Limitless dark slate sidebar (constant across modes). */
export const sidebar = {
  bg: '#263238',
  groupBg: 'rgba(0, 0, 0, 0.15)',
  hover: 'rgba(255, 255, 255, 0.06)',
  active: 'rgba(255, 255, 255, 0.10)',
  accent: '#2196F3',
  border: 'rgba(255, 255, 255, 0.08)',
  text: 'rgba(255, 255, 255, 0.75)',
  textStrong: '#FFFFFF',
  textMuted: 'rgba(255, 255, 255, 0.45)',
} as const;

/** Light-mode surfaces — Limitless near-white on #F5F5F5. */
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

/** Dark-mode surfaces. */
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

export const mapAccents = {
  vehicleActive: '#4CAF50',
  vehicleIdle: '#FFC107',
  vehicleOverspeed: '#F44336',
  vehicleOffline: '#9E9E9E',
  geofence: '#3F51B5',
  selectedRoute: '#00BCD4',
} as const;

export const shadows = {
  card: '0 1px 2px rgba(0,0,0,0.05)',
  cardHover: '0 2px 8px rgba(0,0,0,0.08)',
  raised: '0 1px 3px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.24)',
  elevated: '0 6px 16px rgba(0,0,0,0.12), 0 3px 6px rgba(0,0,0,0.08)',
  sidebar: '0.25rem 0 1rem rgba(0,0,0,0.18)',
  darkCard: '0 1px 2px rgba(0,0,0,0.35)',
  darkElevated: '0 8px 28px rgba(0,0,0,0.45), 0 2px 8px rgba(0,0,0,0.30)',
} as const;

export const pillRadius = 100;

/**
 * Glassmorphism tokens (v5 — modern dashboard).
 *
 * Additive-only: used exclusively by the dashboard. All other pages read the
 * original tokens above and are unaffected. Values are tuned for a frosted,
 * premium look in both light and dark modes.
 */
export const glass = {
  /** Light-mode frosted card. */
  light: {
    bg: 'rgba(255, 255, 255, 0.65)',
    bgSolid: 'rgba(255, 255, 255, 0.82)',
    hover: 'rgba(255, 255, 255, 0.75)',
    border: 'rgba(255, 255, 255, 0.60)',
    borderGradient:
      'linear-gradient(135deg, rgba(255,255,255,0.80) 0%, rgba(255,255,255,0.20) 100%)',
    highlight: 'rgba(255, 255, 255, 0.90)',
    shadow:
      '0 4px 24px rgba(33, 150, 243, 0.06), 0 1px 2px rgba(15, 23, 42, 0.04), inset 0 1px 0 rgba(255,255,255,0.50)',
    shadowHover:
      '0 12px 40px rgba(33, 150, 243, 0.12), 0 4px 8px rgba(15, 23, 42, 0.06), inset 0 1px 0 rgba(255,255,255,0.60)',
    blur: 20,
  },
  /** Dark-mode frosted card. */
  dark: {
    bg: 'rgba(30, 39, 51, 0.60)',
    bgSolid: 'rgba(42, 51, 61, 0.80)',
    hover: 'rgba(50, 61, 72, 0.70)',
    border: 'rgba(255, 255, 255, 0.10)',
    borderGradient:
      'linear-gradient(135deg, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0.04) 100%)',
    highlight: 'rgba(255, 255, 255, 0.08)',
    shadow:
      '0 4px 24px rgba(0, 0, 0, 0.30), 0 1px 2px rgba(0, 0, 0, 0.20), inset 0 1px 0 rgba(255,255,255,0.06)',
    shadowHover:
      '0 12px 40px rgba(0, 0, 0, 0.40), 0 4px 8px rgba(0, 0, 0, 0.25), inset 0 1px 0 rgba(255,255,255,0.08)',
    blur: 20,
  },
  /** The dashboard page background gradient (light). */
  pageGradientLight: 'linear-gradient(135deg, #EEF4FF 0%, #F0F7FF 30%, #FAF5FF 65%, #FEF6F6 100%)',
  /** The dashboard page background gradient (dark). */
  pageGradientDark: 'linear-gradient(135deg, #141B26 0%, #161D2B 40%, #1A1726 70%, #1E181F 100%)',
  /** Aurora blobs rendered behind the dashboard header. */
  aurora: {
    blue: 'rgba(33, 150, 243, 0.28)',
    indigo: 'rgba(63, 81, 181, 0.22)',
    cyan: 'rgba(0, 188, 212, 0.20)',
  },
  /** Radius for glass cards — softer than the flat 3px system default. */
  radius: 16,
  radiusSm: 12,
  radiusLg: 20,
} as const;
