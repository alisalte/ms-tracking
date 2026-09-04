/**
 * useLiveTracking — subscribe to gps-engine position + device-status updates.
 *
 * Connects to the gps-engine WebSocket (Socket.IO, default port 3001) and
 * listens for `position.update` + `device.status` events scoped to the tenant's
 * fleet room. Returns:
 * - `positions`: a Map<vehicleId, LivePosition> updated in real-time
 * - `statuses`: a Map<vehicleId, DeviceStatus> for online/offline/stale
 * - `connectionState`: the underlying socket state
 *
 * In dev (no gps-engine running), this is a no-op — the hook stays
 * 'disconnected' and the initial positions come from the REST fallback.
 *
 * Wire format (gps-engine signal-bus):
 * - position.update: { tenantId, vehicleId, latitude, longitude, speedKph, headingDeg, capturedAt, quality }
 * - device.status:   { tenantId, deviceId, state: 'ONLINE'|'OFFLINE'|'STALE', lastSeenAt }
 */
import { useEffect, useRef, useState } from 'react';

import { type ConnectionState, useRealtimeSocket } from '@/hooks/useRealtimeSocket';
import { resolveRealtimeTarget } from '@/lib/realtime-url';
import type { MapVehicle } from '@/types/fleet.types';

/** A live position update from the gps-engine (wire format). */
export interface LivePosition {
  vehicleId: string;
  /** Wire field name from gps-engine: `latitude`. */
  latitude: number;
  /** Wire field name from gps-engine: `longitude`. */
  longitude: number;
  /** Wire field name from gps-engine: `speedKph`. */
  speedKph: number;
  /** Wire field name from gps-engine: `headingDeg`. */
  headingDeg: number;
  capturedAt: string;
  quality: string;
}

/** A device-status update from the gps-engine. */
export interface DeviceStatus {
  deviceId: string;
  state: 'ONLINE' | 'OFFLINE' | 'STALE';
  lastSeenAt: string;
}

export interface LiveTrackingResult {
  /** Live positions keyed by vehicleId. */
  positions: Map<string, LivePosition>;
  /** Device statuses keyed by deviceId (or vehicleId as fallback). */
  statuses: Map<string, DeviceStatus>;
  /** WebSocket connection state. */
  connectionState: ConnectionState;
}

/**
 * Subscribe to real-time fleet position updates.
 *
 * @param tenantId The tenant scope (used to build the room name).
 * @param wsUrl    The gps-engine WS URL (default from env or localhost:3001).
 */
export function useLiveTracking(tenantId: string | null, wsUrl?: string): LiveTrackingResult {
  const target = resolveRealtimeTarget(
    wsUrl ?? import.meta.env.VITE_GPS_WS_URL,
    'http://localhost:3001',
    '/gps-ws/socket.io',
  );
  const enabled = Boolean(tenantId);

  const { state, subscribe, emit } = useRealtimeSocket({
    url: target.url,
    path: target.path,
    enabled,
  });

  const [positions, setPositions] = useState<Map<string, LivePosition>>(new Map());
  const [statuses, setStatuses] = useState<Map<string, DeviceStatus>>(new Map());

  // Track the current tenant so we can re-subscribe to the correct room.
  const tenantRef = useRef(tenantId);
  tenantRef.current = tenantId;

  // Join the fleet room on connect.
  useEffect(() => {
    if (state === 'connected' && tenantRef.current) {
      emit('subscribe', `tenant:${tenantRef.current}:fleet`);
    }
  }, [state, emit]);

  // Listen for position updates.
  useEffect(() => {
    if (!enabled) return;
    const unsub = subscribe('position.update', (raw) => {
      const data = raw as LivePosition & { tenantId: string };
      if (!data.vehicleId) return;
      setPositions((prev) => {
        const next = new Map(prev);
        next.set(data.vehicleId, {
          vehicleId: data.vehicleId,
          latitude: data.latitude,
          longitude: data.longitude,
          speedKph: data.speedKph,
          headingDeg: data.headingDeg,
          capturedAt: data.capturedAt ?? new Date().toISOString(),
          quality: data.quality ?? 'VALID',
        });
        return next;
      });
    });
    return unsub;
  }, [enabled, subscribe]);

  // Listen for device-status updates.
  useEffect(() => {
    if (!enabled) return;
    const unsub = subscribe('device.status', (raw) => {
      const data = raw as DeviceStatus & { tenantId: string };
      if (!data.deviceId) return;
      setStatuses((prev) => {
        const next = new Map(prev);
        next.set(data.deviceId, {
          deviceId: data.deviceId,
          state: data.state,
          lastSeenAt: data.lastSeenAt,
        });
        return next;
      });
    });
    return unsub;
  }, [enabled, subscribe]);

  return { positions, statuses, connectionState: state };
}

/**
 * Merge live updates into the REST-fetched fleet list (§18/§19/§32).
 *
 * - `live` positions (keyed by vehicleId, latest-wins) patch lat/lng/speed/
 *   heading/updatedAt;
 * - `statuses` (keyed by deviceId — MapVehicle.deviceId joins them, vehicleId
 *   as a fallback) patch presence + lastSeenAt so connection flips show live;
 * - the movement `state` is recomputed from the merged presence + position the
 *   same way the REST bootstrap derives it (offline → offline, stale → stopped,
 *   moving → driving, ignition off → stopped, else idle).
 *
 * A live delta that is MDVR GPS junk (Norwegian Sea ~67°N, 0°E) is ignored.
 * A live delta that teleports more than 250 km from a *fresh* REST bootstrap is
 * ignored, unless the REST point itself is junk (so a real fix can correct it).
 * Vehicles without a live delta are returned unchanged.
 */
export function mergeLivePositions(
  vehicles: MapVehicle[],
  live: Map<string, LivePosition>,
  statuses?: Map<string, DeviceStatus>,
): MapVehicle[] {
  if (live.size === 0 && (!statuses || statuses.size === 0)) return vehicles;
  return vehicles.map((v) => {
    const raw = live.get(v.id);
    const pos = raw && !isTeleport(v, raw) ? raw : undefined;
    const status = statuses ? (statuses.get(v.deviceId ?? '') ?? statuses.get(v.id)) : undefined;
    if (!pos && !status) return v;
    // A WS status delta wins; without one the bootstrapped presence stands
    // (never fabricate UNKNOWN — absence of a delta is not absence of a record).
    const presence = status?.state ?? v.presence;
    let state: MapVehicle['state'];
    if (presence === 'OFFLINE' || presence === 'UNKNOWN') {
      state = 'offline';
    } else if (presence === 'STALE') {
      state = 'stopped';
    } else if (pos) {
      // The live wire carries no ignition flag — moving is provable, at rest
      // is reported as idle (the same default the bootstrap uses for unknown).
      state = pos.speedKph > 2 ? 'driving' : 'idle';
    } else {
      state = v.state; // no position delta — keep the bootstrapped movement state
    }
    return {
      ...v,
      state,
      lat: pos?.latitude ?? v.lat,
      lng: pos?.longitude ?? v.lng,
      speed: pos?.speedKph ?? v.speed,
      heading: pos?.headingDeg ?? v.heading,
      updatedAt: pos?.capturedAt ?? v.updatedAt,
      presence,
      lastSeenAt: status?.lastSeenAt ?? v.lastSeenAt,
    };
  });
}

/** Ignore a live fix that jumps more than 250 km from a fresh REST bootstrap. */
const TELEPORT_M = 250_000;
/** REST last-known older than this is not a live lock — the vehicle may have travelled. */
const REST_FRESH_MS = 30 * 60_000;

/** MDVR invalid-GPS junk seen in the wild (Norwegian Sea ~67.28, 0.20). */
function isGarbageFix(lat: number, lng: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return true;
  if (lat === 0 && lng === 0) return true;
  return lat > 60 && Math.abs(lng) < 8;
}

function isTeleport(v: MapVehicle, pos: LivePosition): boolean {
  if (isGarbageFix(pos.latitude, pos.longitude)) return true;
  if (isGarbageFix(v.lat, v.lng)) return false;
  if (!Number.isFinite(v.lat) || !Number.isFinite(v.lng)) return false;
  const dLat = ((pos.latitude - v.lat) * Math.PI) / 180;
  const dLng = ((pos.longitude - v.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((v.lat * Math.PI) / 180) *
      Math.cos((pos.latitude * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  const meters = 6_371_000 * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
  if (meters <= TELEPORT_M) return false;
  const restTs = v.updatedAt ? Date.parse(v.updatedAt) : Number.NaN;
  if (!Number.isFinite(restTs) || Date.now() - restTs > REST_FRESH_MS) return false;
  return true;
}
