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
});
export type CreateVehicleInput = z.infer<typeof createVehicleSchema>;

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
