/**
 * Device domain types (Sprint C §8, §9).
 *
 * `DeviceStatus` is the device LIFECYCLE (authorization) status — it mirrors the
 * device-gateway's `DeviceStatus` (infrastructure/registry/device-registry.port.ts)
 * so the resolve endpoint returns the exact enum the gateway's AuthResolver acts
 * on. It is deliberately separate from the connection state (ONLINE/OFFLINE/STALE)
 * that the gateway projects into tracking.device_status (§9: "status must not be
 * confused with connection state").
 */
import type { Imei } from './imei.js';

/** Device lifecycle status — what the registry tells the gateway. */
export type DeviceStatus = 'ACTIVE' | 'SUSPENDED' | 'DECOMMISSIONED' | 'UNPAIRED';

/**
 * Supported device protocols = the device-gateway's built-in adapter ids
 * (06 §2.1). Hardcoded to what actually exists; do NOT invent protocols the
 * gateway cannot decode (Sprint C §8).
 */
export const PROTOCOLS = ['gt06', 'jt808', 'meitrack', 'stub'] as const;
export type Protocol = (typeof PROTOCOLS)[number];

/** Roles a bound device may play on a vehicle (extensible — §11). */
export const DEVICE_ROLES = ['TRACKER', 'MDVR', 'CAN', 'SENSOR', 'OTHER'] as const;
export type DeviceRole = (typeof DEVICE_ROLES)[number];

/** A device record (camelCase domain shape; repositories map to/from snake_case rows). */
export interface DeviceRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly imei: Imei;
  readonly serialNumber: string | null;
  readonly manufacturer: string | null;
  readonly model: string | null;
  readonly protocol: Protocol;
  readonly status: DeviceStatus;
  /**
   * The vehicle this device is currently bound to (Sprint E) — null when
   * unbound. Populated on LIST reads via a scalar subquery (no join, so the
   * cursor pagination's `created_at` ordering stays unambiguous).
   */
  readonly vehicleId: string | null;
  readonly lastSeenAt: Date | null;
  readonly connectedAt: Date | null;
  readonly disconnectedAt: Date | null;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * The trusted resolution the device-gateway needs (registry port contract).
 * Mirrors `ResolvedDevice` in the gateway's device-registry.port.ts. `vehicleId`
 * is the device's currently-bound vehicle (null if UNPAIRED / not bound).
 */
export interface ResolvedDevice {
  readonly deviceId: string;
  readonly tenantId: string;
  readonly status: DeviceStatus;
  readonly protocol: Protocol;
  readonly vehicleId: string | null;
}

/** Outcome of an IMEI lookup by the resolve endpoint: found | not-found. */
export type DeviceResolution =
  | { readonly found: false; readonly tenantActive: boolean }
  | { readonly found: true; readonly device: ResolvedDevice; readonly tenantActive: boolean };
