/**
 * Asset Management domain types (UI-facing, camelCase).
 *
 * Mirrors the operational fleet-asset entity models from the bounded-context
 * module docs: `Fleet-Management.md` §2 (Vehicle + VehicleGroup),
 * `Driver-Management.md` §2 (DriverProfile + License),
 * `Telemetry-Device-Management.md` §2 (TelematicsDevice). The financial/lifecycle
 * `Asset` aggregate (`Asset-Management.md`) is a separate concern (TCO,
 * depreciation) and is not modeled here — this is the operational asset
 * registry surface (vehicles, drivers, devices, groups).
 *
 * The wire (`*Wire`) snake_case variants will be added here when the
 * `fleet-management-service`, `driver-management-service`, and
 * `device-management-service` REST endpoints land; today the Asset Management
 * page reads from static mock data (`mock/asset-data.ts`) so the UI is fully
 * demoable.
 *
 * Color semantics live in `theme/palette.ts` (`status.*`); the string status
 * keys here map to those tokens so the UI never hardcodes hex values.
 */
import type { VehicleType } from './fleet.types';

// ── Vehicles (Fleet-Management.md §2) ────────────────────────────────────────

/** Vehicle lifecycle status (Fleet-Management §2 VehicleStatus). */
export type VehicleStatus = 'active' | 'inactive' | 'maintenance' | 'decommissioned' | 'sold';

/** Fuel type (Fleet-Management §2 FuelType). */
export type FuelType = 'diesel' | 'gasoline' | 'electric' | 'hybrid' | 'cng' | 'lpg';

/** A registered vehicle (Fleet-Management §2 Vehicle aggregate, UI subset). */
export interface Vehicle {
  id: string;
  /** 17-char VIN (ISO 3779). */
  vin: string;
  make: string;
  model: string;
  year: number;
  licensePlate: string;
  color: string;
  fuelType: FuelType;
  /** Body type — selects the list icon (shared with the map). */
  type: VehicleType;
  status: VehicleStatus;
  fleetId: string;
  fleetName: string;
  /** Optional vehicle group membership. */
  groupId?: string;
  groupName?: string;
  /** Bound telematics device id, if any. */
  deviceId?: string;
  odometerKm: number;
  purchaseDate?: string;
  warrantyExpiry?: string;
  insurancePolicy?: string;
  updatedAt: string;
}

// ── Drivers (Driver-Management.md §2) ────────────────────────────────────────

/** Driver lifecycle status (Driver-Management §2 DriverStatus). */
export type DriverStatus = 'active' | 'inactive' | 'suspended' | 'terminated';

/** A driver profile (Driver-Management §2 DriverProfile, UI subset). */
export interface Driver {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  employeeId?: string;
  status: DriverStatus;
  hireDate?: string;
  /** Driver's license (Driver-Management §2 License). */
  licenseNumber: string;
  licenseClass: string;
  /** ISO date — surfaced with expiry warnings. */
  licenseExpiry: string;
  /** 0–100 driving-quality score (Driver-Management §2 BehaviorScore). */
  behaviorScore: number;
  totalTrips: number;
  totalDistanceKm: number;
  /** Active assignment (Driver-Management §2 DriverAssignment). */
  assignedVehicleId?: string;
  assignedVehicleLabel?: string;
  certifications: string[];
}

// ── Devices (Telemetry-Device-Management.md §2) ──────────────────────────────

/** Device lifecycle status (Telemetry §2 DeviceStatus). */
export type DeviceStatus =
  | 'provisioned'
  | 'active'
  | 'inactive'
  | 'firmware_updating'
  | 'faulted'
  | 'decommissioned';

/** Device hardware type (Telemetry §2 DeviceType). */
export type DeviceType = 'obd2' | 'gps_tracker' | 'dashcam' | 'custom_sensor';

/** A telematics device (Telemetry §2 TelematicsDevice, UI subset). */
export interface Device {
  id: string;
  /** Manufacturer serial number (globally unique). */
  serialNumber: string;
  /** Cellular IMEI, if applicable. */
  imei?: string;
  deviceType: DeviceType;
  manufacturer: string;
  model: string;
  firmwareVersion: string;
  /** Pending OTA target, if a rollout is in progress. */
  targetFirmwareVersion?: string;
  status: DeviceStatus;
  /** Vehicle this device is installed on, if bound. */
  boundVehicleId?: string;
  boundVehicleLabel?: string;
  /** ISO timestamp of the last heartbeat. */
  lastHeartbeatAt?: string;
  /** ISO timestamp of the last data transmission. */
  lastDataAt?: string;
  /** Battery percentage (battery-powered devices). */
  batteryLevel?: number;
  /** Signal strength in dBm. */
  signalStrengthDbm?: number;
  /** Reporting interval in seconds. */
  reportingIntervalSec: number;
}

// ── Groups (Fleet-Management.md §2 VehicleGroup) ─────────────────────────────

/** Group lifecycle status (Fleet-Management §2 GroupStatus). */
export type GroupStatus = 'active' | 'archived';

/** A vehicle group — a saved set of vehicles (Fleet-Management §2 VehicleGroup). */
export interface VehicleGroup {
  id: string;
  name: string;
  description: string;
  memberCount: number;
  /** Optional vehicle-type filter the group is scoped to. */
  vehicleTypeFilter?: VehicleType;
  status: GroupStatus;
  createdAt: string;
}

// ── Shared filter shape ──────────────────────────────────────────────────────

/** Per-tab filter state (status facet + free-text). */
export interface AssetFilter<TStatus extends string = string> {
  status: TStatus | 'all';
  query: string;
}

// ── Create / Update payloads (camelCase, UI-facing) ──────────────────────────
//
// These are the typed contracts the create/edit forms submit and the asset API
// hooks accept. They mirror the editable subset of each entity. Required vs
// optional matches the domain model (identifying/registry fields required;
// associations + lifecycle defaults optional).
//
// Wire (`*Wire`) snake_case variants + `mapX(wire)` mappers live in
// `api/asset.api.ts` (single place for wire translation), ready for when the
// fleet-management / driver-management / device-management services ship their
// REST endpoints. See docs/frontend-crud.md.

/** Create a vehicle (POST /fleet/vehicles). */
export interface CreateVehiclePayload {
  licensePlate: string;
  vin: string;
  make: string;
  model: string;
  year: number;
  type: VehicleType;
  fuelType: FuelType;
  color: string;
  status: VehicleStatus;
  groupId?: string;
  deviceId?: string;
}

/** Update a vehicle (PATCH /fleet/vehicles/:id) — every field optional. */
export type UpdateVehiclePayload = Partial<CreateVehiclePayload>;

/** Create a driver (POST /drivers). */
export interface CreateDriverPayload {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  employeeId?: string;
  status: DriverStatus;
  licenseNumber: string;
  licenseClass: string;
  licenseExpiry: string;
  assignedVehicleId?: string;
}

/** Update a driver (PATCH /drivers/:id). */
export type UpdateDriverPayload = Partial<CreateDriverPayload>;

/** Create a device (POST /telemetry/devices). */
export interface CreateDevicePayload {
  serialNumber: string;
  deviceType: DeviceType;
  manufacturer: string;
  model: string;
  imei?: string;
  firmwareVersion: string;
  reportingIntervalSec: number;
  status: DeviceStatus;
  boundVehicleId?: string;
}

/** Update a device (PATCH /telemetry/devices/:id). */
export type UpdateDevicePayload = Partial<CreateDevicePayload>;

/** Create a group (POST /fleet/groups). */
export interface CreateGroupPayload {
  name: string;
  description: string;
  vehicleTypeFilter?: VehicleType;
  status: GroupStatus;
}

/** Update a group (PATCH /fleet/groups/:id). */
export type UpdateGroupPayload = Partial<CreateGroupPayload>;
