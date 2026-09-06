import type { MapVehicle, VehiclePresence } from '@/types/fleet.types';

/**
 * Demo status palette for color-testing map markers. Eight slots so a typical
 * small live fleet (one of each hue + heading) is covered without repetition.
 */
export const DEMO_STATUS_PALETTE: ReadonlyArray<{
  state: MapVehicle['state'];
  presence: VehiclePresence;
  speed: number;
}> = [
  { state: 'driving', presence: 'ONLINE', speed: 64 },
  { state: 'idle', presence: 'ONLINE', speed: 0 },
  { state: 'overspeed', presence: 'ONLINE', speed: 128 },
  { state: 'stopped', presence: 'ONLINE', speed: 0 },
  { state: 'offline', presence: 'OFFLINE', speed: 0 },
  { state: 'stopped', presence: 'STALE', speed: 0 },
  { state: 'offline', presence: 'UNKNOWN', speed: 0 },
  { state: 'driving', presence: 'ONLINE', speed: 48 },
];

export const MAP_DEMO_STATUS_STORAGE_KEY = 'fv:map-demo-status';
export const MAP_DEMO_STATUS_CHANGE_EVENT = 'fv:demo-status-change';
/** On by default so a small live fleet can be color-tested immediately. */
export const DEFAULT_MAP_DEMO_STATUS = true;

export function loadPersistedMapDemoStatus(): boolean {
  try {
    const saved = localStorage.getItem(MAP_DEMO_STATUS_STORAGE_KEY);
    if (saved === '0' || saved === 'false') return false;
    if (saved === '1' || saved === 'true') return true;
  } catch {
    // Private-mode storage etc.
  }
  return DEFAULT_MAP_DEMO_STATUS;
}

export function persistMapDemoStatus(on: boolean): void {
  try {
    localStorage.setItem(MAP_DEMO_STATUS_STORAGE_KEY, on ? '1' : '0');
  } catch {
    // best-effort
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(MAP_DEMO_STATUS_CHANGE_EVENT, { detail: on }));
  }
}

/** Stable round-robin of status + heading across the current fleet. */
export function applyDemoStatuses(vehicles: readonly MapVehicle[]): MapVehicle[] {
  if (vehicles.length === 0) return vehicles as MapVehicle[];
  const order = [...vehicles].sort((a, b) => a.id.localeCompare(b.id));
  const slotOf = new Map(order.map((v, i) => [v.id, i]));
  return vehicles.map((v) => {
    const slot = slotOf.get(v.id) ?? 0;
    const sample = DEMO_STATUS_PALETTE[slot % DEMO_STATUS_PALETTE.length] ?? DEMO_STATUS_PALETTE[0];
    if (!sample) return v;
    return {
      ...v,
      state: sample.state,
      presence: sample.presence,
      speed: sample.speed,
      heading: (slot * 45) % 360,
      ignitionOn: sample.state !== 'offline' && sample.state !== 'stopped',
    };
  });
}
