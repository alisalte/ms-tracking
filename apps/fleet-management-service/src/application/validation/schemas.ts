/**
 * Zod request schemas (Sprint C §16). Reused by the controllers (ZodValidationPipe)
 * and the unit tests, so validation lives in exactly one place.
 *
 * INV-I02 (Sprint B): no schema ever accepts `tenant_id` from the body — the
 * tenant is taken from the verified credential in the controller. This is pinned
 * by the integration tests (cross-tenant writes are impossible via the body).
 */
import { z } from 'zod';
import {
  DEVICE_ROLES,
  type DeviceRole,
  type DeviceStatus,
  PROTOCOLS,
  type Protocol,
} from '../../domain/device/device-types.js';
import { IMEI_LENGTH, isValidImei, normalizeImei } from '../../domain/device/imei.js';

// --- Shared primitives -------------------------------------------------------

const uuid = z.string().uuid();
const name = z.string().trim().min(1).max(200);
/** Code: tenant-visible short identifier. Alnum + dash/underscore, max 64. */
const code = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, 'code may only contain letters, numbers, "_" and "-"');
/** Dashboard odometer (km). Empty/omitted → unset; 0 is a valid new-vehicle reading. */
const ODOMETER_KM_MAX = 10_000_000;
const ENGINE_HOURS_MAX = 1_000_000;
const odometerKm = z.preprocess((v) => {
  if (v === '' || v === undefined) return undefined;
  return v;
}, z.coerce.number().finite().min(0).max(ODOMETER_KM_MAX).optional());
/** PATCH may clear the reading with `null` (do not coerce null → 0). */
const odometerKmPatch = z.preprocess((v) => {
  if (v === '' || v === undefined) return undefined;
  if (v === null) return null;
  return v;
}, z.union([z.null(), z.coerce.number().finite().min(0).max(ODOMETER_KM_MAX)]).optional());
/** Hour-meter for heavy equipment. Same empty/null rules as odometerKm. */
const engineHours = z.preprocess((v) => {
  if (v === '' || v === undefined) return undefined;
  return v;
}, z.coerce.number().finite().min(0).max(ENGINE_HOURS_MAX).optional());
const engineHoursPatch = z.preprocess((v) => {
  if (v === '' || v === undefined) return undefined;
  if (v === null) return null;
  return v;
}, z.union([z.null(), z.coerce.number().finite().min(0).max(ENGINE_HOURS_MAX)]).optional());
/** Canonical, Luhn-valid IMEI. Stored normalized (15 digits). */
const imeiField = z
  .string()
  .trim()
  .min(IMEI_LENGTH)
  .refine(isValidImei, 'imei must be 15 digits with a valid Luhn check digit')
  .transform(normalizeImei);

/** Cursor-based list query (shared-kernel pagination standard — §15). */
export const listQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  search: z.string().trim().optional(),
});

// --- Fleet (§6) --------------------------------------------------------------

export const createFleetSchema = z.object({
  name,
  code,
  description: z.string().trim().max(1000).optional(),
});
export type CreateFleetInput = z.infer<typeof createFleetSchema>;

export const updateFleetSchema = z.object({
  name,
  code,
  description: z.string().trim().max(1000).optional(),
});
export type UpdateFleetInput = z.infer<typeof updateFleetSchema>;

export const fleetListQuerySchema = listQuerySchema.extend({
  status: z.enum(['ACTIVE', 'ARCHIVED']).optional(),
});

// --- Vehicle (§7) ------------------------------------------------------------

export const createVehicleSchema = z.object({
  fleetId: uuid,
  name,
  code,
  plate: z.string().trim().min(1).max(32).optional(),
  vin: z
    .string()
    .trim()
    .min(1)
    .max(17)
    .regex(/^[A-HJ-NPR-Z0-9]+$/i, 'vin may only contain letters and numbers (no I/O/Q)')
    .optional(),
  odometerKm,
  engineHours,
});
export type CreateVehicleInput = z.infer<typeof createVehicleSchema>;

/** Max rows accepted by vehicle/device spreadsheet import. */
export const IMPORT_MAX_ROWS = 500;

/**
 * One spreadsheet vehicle row. `fleetCode` is the tenant-visible fleet code
 * (Excel users never have UUIDs). `row` is the 1-based sheet row for errors.
 */
export const importVehicleRowSchema = z.object({
  row: z.coerce.number().int().min(1).optional(),
  name,
  code,
  /** Tenant-visible fleet code or name (Excel); resolved in the service. */
  fleetCode: z.string().trim().min(1).max(200),
  plate: z.string().trim().min(1).max(32).optional(),
  vin: z
    .string()
    .trim()
    .min(1)
    .max(17)
    .regex(/^[A-HJ-NPR-Z0-9]+$/i, 'vin may only contain letters and numbers (no I/O/Q)')
    .optional(),
  odometerKm,
  engineHours,
});
export type ImportVehicleRowInput = z.infer<typeof importVehicleRowSchema>;

/** Loose envelope — per-row validation happens in the service (partial success). */
export const importVehiclesBodySchema = z.object({
  rows: z.array(z.record(z.unknown())).min(1).max(IMPORT_MAX_ROWS),
});
export type ImportVehiclesBody = z.infer<typeof importVehiclesBodySchema>;

export const updateVehicleSchema = z.object({
  fleetId: uuid.optional(),
  name,
  code,
  plate: z.string().trim().min(1).max(32).optional(),
  vin: z
    .string()
    .trim()
    .min(1)
    .max(17)
    .regex(/^[A-HJ-NPR-Z0-9]+$/i, 'vin may only contain letters and numbers (no I/O/Q)')
    .optional(),
  odometerKm: odometerKmPatch,
  engineHours: engineHoursPatch,
});
export type UpdateVehicleInput = z.infer<typeof updateVehicleSchema>;

export const vehicleListQuerySchema = listQuerySchema.extend({
  fleetId: uuid.optional(),
  status: z.enum(['ACTIVE', 'ARCHIVED']).optional(),
});

// --- Device (§8) -------------------------------------------------------------

export const deviceStatusSchema = z.enum(['ACTIVE', 'SUSPENDED', 'DECOMMISSIONED', 'UNPAIRED']);

export const createDeviceSchema = z.object({
  imei: imeiField,
  serialNumber: z.string().trim().min(1).max(128).optional(),
  manufacturer: z.string().trim().min(1).max(128).optional(),
  model: z.string().trim().min(1).max(128).optional(),
  protocol: z.enum(PROTOCOLS),
  status: deviceStatusSchema.optional(),
});
export type CreateDeviceInput = z.infer<typeof createDeviceSchema>;

/**
 * One spreadsheet device row. Optional `vehicleCode` binds the new device
 * after create (TRACKER; primary when the vehicle has none).
 */
export const importDeviceRowSchema = z.object({
  row: z.coerce.number().int().min(1).optional(),
  imei: imeiField,
  serialNumber: z.string().trim().min(1).max(128).optional(),
  manufacturer: z.string().trim().min(1).max(128).optional(),
  model: z.string().trim().min(1).max(128).optional(),
  protocol: z.enum(PROTOCOLS),
  vehicleCode: z.string().trim().min(1).max(200).optional(),
});
export type ImportDeviceRowInput = z.infer<typeof importDeviceRowSchema>;

export const importDevicesBodySchema = z.object({
  rows: z.array(z.record(z.unknown())).min(1).max(IMPORT_MAX_ROWS),
});
export type ImportDevicesBody = z.infer<typeof importDevicesBodySchema>;

export const updateDeviceSchema = z.object({
  serialNumber: z.string().trim().min(1).max(128).optional(),
  manufacturer: z.string().trim().min(1).max(128).optional(),
  model: z.string().trim().min(1).max(128).optional(),
  protocol: z.enum(PROTOCOLS).optional(),
  status: deviceStatusSchema.optional(),
});
export type UpdateDeviceInput = z.infer<typeof updateDeviceSchema>;

export const deviceListQuerySchema = listQuerySchema.extend({
  status: deviceStatusSchema.optional(),
  protocol: z.enum(PROTOCOLS).optional(),
  manufacturer: z.string().trim().optional(),
  vehicleId: uuid.optional(),
  imei: z.string().trim().optional(),
});

// --- Binding (§11) -----------------------------------------------------------

/** Bind request body. `deviceId` comes from the URL path, NOT the body. */
export const bindBodySchema = z.object({
  role: z.enum(DEVICE_ROLES).optional(),
  isPrimary: z.boolean().optional(),
});
export type BindDeviceInput = z.infer<typeof bindBodySchema>;

// --- Device commands (06 §11.3 SendDeviceCommand) -----------------------------

export const deviceCommandStatusSchema = z.enum(['QUEUED', 'SENT', 'ACKED', 'FAILED', 'EXPIRED']);

/**
 * Issue a device command. `params` is validated semantically against the
 * command catalog (validateParams) — this envelope only bounds the shape.
 */
export const createDeviceCommandSchema = z.object({
  commandCode: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{1,3}[0-9A-Za-z]{0,2}$/, 'Invalid command code format.'),
  params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  ttlSec: z.coerce.number().int().min(5).max(600).optional(),
});
export type CreateDeviceCommandInput = z.infer<typeof createDeviceCommandSchema>;

/** Same command + params applied to many devices (partial success). */
export const BULK_COMMAND_MAX_DEVICES = 200;
export const bulkCreateDeviceCommandSchema = createDeviceCommandSchema.extend({
  deviceIds: z.array(z.string().uuid()).min(1).max(BULK_COMMAND_MAX_DEVICES),
});
export type BulkCreateDeviceCommandInput = z.infer<typeof bulkCreateDeviceCommandSchema>;

export const deviceCommandListQuerySchema = listQuerySchema.extend({
  status: deviceCommandStatusSchema.optional(),
  commandCode: z.string().trim().optional(),
});

// --- Helpers exposed to services/tests --------------------------------------

export const PROTOCOL_VALUES = PROTOCOLS as readonly string[];
export function isProtocol(v: string): v is Protocol {
  return (PROTOCOLS as readonly string[]).includes(v);
}
export function isDeviceRole(v: string): v is DeviceRole {
  return (DEVICE_ROLES as readonly string[]).includes(v);
}
export function isDeviceStatus(v: string): v is DeviceStatus {
  return v === 'ACTIVE' || v === 'SUSPENDED' || v === 'DECOMMISSIONED' || v === 'UNPAIRED';
}
