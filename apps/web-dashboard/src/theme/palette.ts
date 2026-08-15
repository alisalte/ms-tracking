/**
 * FleetVision Design System — Color palette (v5 — TailAdmin-faithful).
 *
 * TailAdmin React indigo primary on a dark sidebar, layered neutral surfaces,
 * restrained gradients. The indigo brand is applied to every MUI page through
 * the theme; Tailwind components read the matching tokens from
 * `src/styles/tailwind.css`. FleetVision identity carried by the brand mark.
 */

/** Neutral ramp — TailAdmin `gray` family (light) + the legacy keys kept stable. */
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

/** Primary — TailAdmin indigo. */
export const primary = {
  main: '#465FFB',
  light: '#8199FD',
  lighter: '#C7D8FF',
  dark: '#3641F5',
  darker: '#2D31D4',
  hover: '#3641F5',
  pressed: '#2D31D4',
  tint: 'rgba(70, 95, 251, 0.10)',
  brandGradient: 'linear-gradient(135deg, #465FFB 0%, #6366F1 100%)',
  gradient: 'linear-gradient(135deg, #465FFB 0%, #6366F1 100%)',
} as const;

/** Status colors — TailAdmin semantic set. */
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

/** The signature TailAdmin dark sidebar (constant across modes). */
export const sidebar = {
  bg: '#1A222C',
  groupBg: 'rgba(255, 255, 255, 0.03)',
  hover: 'rgba(255, 255, 255, 0.06)',
  active: '#3C50E0',
  accent: '#465FFB',
  border: 'rgba(255, 255, 255, 0.06)',
  text: '#9AA5B5',
  textStrong: '#FFFFFF',
  textMuted: '#6B7280',
} as const;

/** Light-mode surfaces — TailAdmin near-white on gray-50. */
export const lightSurface = {
  bg: '#F9FAFB',
  paper: '#FFFFFF',
  elevated: '#FFFFFF',
  hover: '#F9FAFB',
  tableHead: '#F9FAFB',
  border: '#E4E7EC',
  borderStrong: '#D0D5DD',
  divider: '#E4E7EC',
} as const;

/** Dark-mode surfaces — TailAdmin graydark layered family. */
export const darkSurface = {
  bg: '#101828',
  paper: '#1A222C',
  elevated: '#333A48',
  hover: '#2A3340',
  tableHead: '#1D2632',
  border: 'rgba(255, 255, 255, 0.06)',
  borderStrong: 'rgba(255, 255, 255, 0.12)',
  divider: 'rgba(255, 255, 255, 0.06)',
} as const;

export const mapAccents = {
  vehicleActive: '#12B76A',
  vehicleIdle: '#F79009',
  vehicleOverspeed: '#F04438',
  vehicleOffline: '#98A2B3',
  geofence: '#465FFB',
  selectedRoute: '#06B6D4',
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
