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
