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
  const url = wsUrl ?? import.meta.env.VITE_GPS_WS_URL ?? 'http://localhost:3001';
  const enabled = Boolean(tenantId);

  const { state, subscribe, emit } = useRealtimeSocket({ url, enabled });

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
 * Merge live positions into the REST-fetched fleet list.
 *
 * Returns a new array where vehicles that have a live position update are
 * patched with the latest lat/lng/speed/heading/timestamp.
 */
export function mergeLivePositions(
  vehicles: MapVehicle[],
  live: Map<string, LivePosition>,
): MapVehicle[] {
  if (live.size === 0) return vehicles;
  return vehicles.map((v) => {
    const pos = live.get(v.id);
    if (!pos) return v;
    return {
      ...v,
      lat: pos.latitude,
      lng: pos.longitude,
      speed: pos.speedKph,
      heading: pos.headingDeg,
      updatedAt: pos.capturedAt,
    };
  });
}
