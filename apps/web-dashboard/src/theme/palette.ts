/**
 * FleetVision Design System — Color palette (v2 — premium dark SaaS).
 *
 * Semantic, accessible (≥ 4.5:1 contrast on text). Built around a deep navy
 * dark base with a refined-blue gradient accent system. Source: UI_UX_Design.md
 * §0.2, modernized for a Linear/Vercel-class dark SaaS aesthetic.
 */

export const neutral = {
  0: '#FFFFFF',
  50: '#F8FAFC',
  100: '#F1F5F9',
  200: '#E2E8F0',
  300: '#CBD5E1',
  400: '#94A3B8',
  500: '#64748B',
  600: '#475569',
  700: '#334155',
  800: '#1E293B',
  900: '#0F172A',
  950: '#020617',
} as const;

/** Refined blue primary — deeper, richer than the original flat #2563EB. */
export const primary = {
  main: '#3B82F6',
  light: '#60A5FA',
  dark: '#2563EB',
  hover: '#2563EB',
  pressed: '#1D4ED8',
  /** Gradient used for buttons, active states, branding panels. */
  gradient: 'linear-gradient(135deg, #3B82F6 0%, #6366F1 100%)',
} as const;

export const status = {
  green: '#22C55E',
  amber: '#F59E0B',
  red: '#EF4444',
  blue: '#3B82F6',
  purple: '#A855F7',
  slate: '#64748B',
} as const;

/** Dark-mode surface scale — layered navy blues (glassmorphism depth). */
export const darkSurface = {
  /** App background — deepest navy. */
  bg: '#0B1120',
  /** Primary card surface. */
  paper: '#111827',
  /** Elevated card (glass effect base). */
  elevated: '#1A2335',
  /** Hover/active surface. */
  hover: '#1E293B',
  /** Border/divider. */
  border: '#1E293B',
  /** Border — lighter (for visible separation). */
  borderLight: '#334155',
} as const;

/** Light-mode surface scale — clean whites + subtle grays. */
export const lightSurface = {
  bg: '#F8FAFC',
  paper: '#FFFFFF',
  elevated: '#FFFFFF',
  hover: '#F1F5F9',
  border: '#E2E8F0',
  borderLight: '#CBD5E1',
} as const;

export const mapAccents = {
  vehicleActive: '#22D3EE',
  vehicleIdle: '#FACC15',
  vehicleOverspeed: '#FB7185',
  vehicleOffline: '#94A3B8',
  geofence: '#A78BFA',
  selectedRoute: '#34D399',
} as const;

/** Premium multi-layer shadows — soft, diffuse, depth-realistic. */
export const shadows = {
  /** Card resting state — barely-there depth. */
  card: '0 1px 3px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.08)',
  /** Card hover — lifts slightly. */
  cardHover: '0 4px 12px rgba(0,0,0,0.15), 0 2px 4px rgba(0,0,0,0.1)',
  /** Elevated / floating element (drawer, popover, menu). */
  elevated: '0 10px 40px rgba(0,0,0,0.25), 0 4px 12px rgba(0,0,0,0.15)',
  /** Dark-mode card — glow-style with blue tint. */
  darkCard: '0 4px 24px rgba(0,0,0,0.4), 0 1px 4px rgba(59,130,246,0.08)',
  /** Dark-mode elevated. */
  darkElevated: '0 12px 48px rgba(0,0,0,0.5), 0 4px 16px rgba(59,130,246,0.12)',
} as const;
