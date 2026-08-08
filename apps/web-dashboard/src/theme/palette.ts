/**
 * FleetVision Design System — Color palette.
 *
 * Semantic, accessible (≥ 4.5:1 contrast on text).
 * Source: UI_UX_Design.md §0.2
 */

export const neutral = {
  0: '#FFFFFF',
  50: '#F8FAFC',
  100: '#F1F5F9',
  200: '#E2E8F0',
  500: '#64748B',
  800: '#1E293B',
  900: '#0F172A',
} as const;

export const primary = {
  main: '#2563EB',
  hover: '#1D4ED8',
  pressed: '#1E40AF',
} as const;

export const status = {
  green: '#16A34A',
  amber: '#F59E0B',
  red: '#DC2626',
  blue: '#2563EB',
  purple: '#9333EA',
  slate: '#64748B',
} as const;

export const mapAccents = {
  vehicleActive: '#22D3EE',
  vehicleIdle: '#FACC15',
  vehicleOverspeed: '#FB7185',
  vehicleOffline: '#94A3B8',
  geofence: '#A78BFA',
  selectedRoute: '#34D399',
} as const;
