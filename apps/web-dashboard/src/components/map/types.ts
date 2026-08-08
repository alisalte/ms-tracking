/**
 * Shared types for the Live Tracking map page.
 *
 * Co-located here so the page, list panel, and filters agree on the filter
 * state shape without importing each other.
 */
import type { MapVehicle } from '@/types/fleet.types';

/** Status facets shown as filter chips + the legend. `'all'` = no filter. */
export type StatusFilter = MapVehicle['state'] | 'overspeed' | 'all';

export const STATUS_FILTERS: StatusFilter[] = [
  'all',
  'driving',
  'idle',
  'overspeed',
  'offline',
  'stopped',
];

/** Localized label key for a status filter value. */
export function statusLabelKey(value: StatusFilter): string {
  return value === 'all' ? 'map.filters.all' : `map.states.${value}`;
}
