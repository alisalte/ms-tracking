/**
 * Asset Management domain types (UI-facing, camelCase).
 *
 * Sprint E: these now mirror the REAL fleet-management-service contracts 1:1
 * (fleets / vehicles / devices + the vehicle↔device binding). The backend wire
 * shape is already camelCase (unlike identity's snake_case), so the API layer
 * only maps Date-bearing strings; there is no mock-shaped "rich vehicle"
 * model anymore — the fields below are exactly what the backend returns.
 *
 * NOTE the two status axes (never conflate them in the UI):
 *  - `VehicleStatus` / `DeviceStatus` = REGISTRY lifecycle (fleet-management).
 *  - `DeviceConnectionState` (fleet.types) = ONLINE/OFFLINE/STALE connection
 *    state (gps-engine tracking projection).
 */
import type { VehicleType } from './fleet.types';

// ── Fleets (fleet-management FleetRecord) ────────────────────────────────────

/** Fleet lifecycle status. DELETE = archive (status flips to ARCHIVED). */
export type FleetStatus = 'ACTIVE' | 'ARCHIVED';

/** A fleet — a grouping of vehicles within the tenant. */
export interface Fleet {
  id: string;
  tenantId: string;
  name: string;
  /** Short unique code (`[A-Za-z0-9_-]`, 1–64). */
  code: string;
  description: string | null;
  status: FleetStatus;
  /** Optimistic-concurrency version (409 on stale writes). */
  version: number;
  createdAt: string;
  updatedAt: string;
}

/** Create a fleet (POST /fleets). */
export interface CreateFleetPayload {
  name: string;
  code: string;
  description?: string;
}

/** Update a fleet (PATCH /fleets/:id — backend takes a full replace). */
export type UpdateFleetPayload = CreateFleetPayload;

// ── Vehicles (fleet-management VehicleRecord) ────────────────────────────────

/** Vehicle lifecycle status. DELETE = archive. */
export type VehicleStatus = 'ACTIVE' | 'ARCHIVED';

/** A registered vehicle (real backend contract — name/code identity, not make/model). */
export interface Vehicle {
  id: string;
  tenantId: string;
  fleetId: string;
  name: string;
  code: string;
  plate: string | null;
  vin: string | null;
  status: VehicleStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/** Create a vehicle (POST /vehicles). */
export interface CreateVehiclePayload {
  fleetId: string;
  name: string;
  code: string;
  plate?: string;
  /** 17 chars, no I/O/Q (ISO 3779). */
  vin?: string;
}

/** Update a vehicle (PATCH /vehicles/:id — full replace, name+code required). */
export type UpdateVehiclePayload = CreateVehiclePayload;

// ── Devices (fleet-management DeviceRecord) ──────────────────────────────────

/** Device REGISTRY lifecycle status — what the gateway resolves. */
export type DeviceStatus = 'ACTIVE' | 'SUSPENDED' | 'DECOMMISSIONED' | 'UNPAIRED';

/** Supported ingest protocols (the gateway's built-in adapters). */
export type DeviceProtocol = 'gt06' | 'jt808' | 'meitrack' | 'stub';

/** A telematics device in the persistent registry. */
export interface Device {
  id: string;
  tenantId: string;
  /** 15-digit Luhn-valid IMEI — the global physical identity (immutable). */
  imei: string;
  serialNumber: string | null;
  manufacturer: string | null;
  model: string | null;
  protocol: DeviceProtocol;
  status: DeviceStatus;
  /** Vehicle currently bound to this device (Sprint E; null = unbound). */
  vehicleId: string | null;
  lastSeenAt: string | null;
  connectedAt: string | null;
  disconnectedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

/** Create a device (POST /devices). */
export interface CreateDevicePayload {
  imei: string;
  serialNumber?: string;
  manufacturer?: string;
  model?: string;
  protocol: DeviceProtocol;
}

/** Update a device (PATCH /devices/:id — imei is immutable server-side). */
export type UpdateDevicePayload = Partial<Omit<CreateDevicePayload, 'imei'>> & {
  status?: DeviceStatus;
};

// ── Vehicle ↔ Device binding (fleet-management) ──────────────────────────────

/** Role a bound device plays on the vehicle. */
export type DeviceRole = 'TRACKER' | 'MDVR' | 'CAN' | 'SENSOR' | 'OTHER';

/** Bind a device to a vehicle (POST /vehicles/:id/devices/:deviceId). */
export interface BindDevicePayload {
  role?: DeviceRole;
  isPrimary?: boolean;
}

/** A device bound to a vehicle (GET /vehicles/:id/devices). */
export interface BoundDevice {
  deviceId: string;
  imei: string;
  manufacturer: string | null;
  model: string | null;
  protocol: DeviceProtocol;
  /** Registry lifecycle status of the device (string — server enum). */
  deviceStatus: string;
  role: string;
  isPrimary: boolean;
  boundAt: string;
}

// ── Dashboard summary (fleet-management GET /summary) ────────────────────────

/** Registry counts for the dashboard stat cards (Sprint E §21). */
export interface FleetSummary {
  fleets: { active: number; archived: number };
  vehicles: { active: number; archived: number };
  devices: { byStatus: Record<string, number>; total: number };
}

// ── Shared filter shape ──────────────────────────────────────────────────────

/** Per-tab filter state (status facet + free-text). */
export interface AssetFilter<TStatus extends string = string> {
  status: TStatus | 'all';
  query: string;
}

/** Map a registry body type to the vehicle-type glyph shown on the map. */
export type VehicleTypeHint = VehicleType;
