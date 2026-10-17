/**
 * Which bound device represents a vehicle on the live map.
 *
 * A vehicle can carry a GPS tracker and an MDVR. The map's online chip and the
 * camera list must follow the same unit: when a Meitrack MDVR is bound, its
 * connection is the vehicle's presence (the tracker is the same physical
 * device). Otherwise the best connection among the bound devices wins, so a
 * later offline sibling cannot hide an online tracker.
 */
import type { VehiclePresence } from '@/types/fleet.types';

export interface VehicleDeviceCandidate {
  protocol?: string | null;
  state?: VehiclePresence | null;
  lastSeenAt?: string | null;
}

const PRESENCE_RANK: Record<VehiclePresence, number> = {
  ONLINE: 0,
  STALE: 1,
  OFFLINE: 2,
  UNKNOWN: 3,
};

export function pickVehicleDevice<T extends VehicleDeviceCandidate>(
  devices: readonly T[],
): T | undefined {
  if (devices.length === 0) return undefined;
  const cameras = devices.filter((d) => d.protocol === 'meitrack');
  const pool = cameras.length > 0 ? cameras : devices;
  return [...pool].sort((a, b) => {
    const ra = PRESENCE_RANK[a.state ?? 'UNKNOWN'] ?? 3;
    const rb = PRESENCE_RANK[b.state ?? 'UNKNOWN'] ?? 3;
    if (ra !== rb) return ra - rb;
    const ta = a.lastSeenAt ? Date.parse(a.lastSeenAt) : 0;
    const tb = b.lastSeenAt ? Date.parse(b.lastSeenAt) : 0;
    return (Number.isFinite(tb) ? tb : 0) - (Number.isFinite(ta) ? ta : 0);
  })[0];
}
