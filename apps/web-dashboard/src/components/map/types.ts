/**
 * Shared types for the Live Tracking map page.
 *
 * Colocated here so the page, list panel, and filters agree on the filter
 * state shape without importing each other.
 */
import type { VehiclePresence } from '@/types/fleet.types';

/**
 * Status facets shown as filter chips + the legend (§18/§20): the REAL device
 * connection presence. `'all'` = no filter. A vehicle with no status record
 * buckets as UNKNOWN.
 */
export type PresenceFilter = VehiclePresence | 'all';

export const PRESENCE_FILTERS: PresenceFilter[] = ['all', 'ONLINE', 'OFFLINE', 'STALE', 'UNKNOWN'];

/** Localized label key for a presence filter value. */
export function presenceLabelKey(value: PresenceFilter): string {
  return value === 'all' ? 'map.filters.all' : `map.presence.${value}`;
}

/** Resolve a vehicle's presence, defaulting missing status records to UNKNOWN. */
export function presenceOf(v: { presence?: VehiclePresence }): VehiclePresence {
  return v.presence ?? 'UNKNOWN';
}
