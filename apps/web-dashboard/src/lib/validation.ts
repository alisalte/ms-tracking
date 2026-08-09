import { z } from 'zod';

/**
 * Shared zod validation schemas for identity forms.
 *
 * Password rules encode the FleetVision Security policy
 * (`docs/modules/Authentication.md` AUTH-BR-01, and IAM config
 * `password.min-length: 12`, require-uppercase/lowercase/digit/special):
 * ≥ 12 chars, mixed case, a digit, and a symbol. The schemas are reused across
 * register, reset-password, and (future) change-password forms.
 *
 * NOTE: client-side validation mirrors the documented policy; the backend
 * remains the source of truth (it also checks breach corpus + history).
 */

/** Minimum password length per AUTH-BR-01. */
export const PASSWORD_MIN_LENGTH = 12;

/**
 * Password schema with granular, i18n-key-free messages.
 * Components map these to translated strings via `t('validation.<rule>')`;
 * the zod message is a stable machine key used as a fallback.
 */
export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, { message: 'validation.password.tooShort' })
  .regex(/[a-z]/, { message: 'validation.password.lowercase' })
  .regex(/[A-Z]/, { message: 'validation.password.uppercase' })
  .regex(/[0-9]/, { message: 'validation.password.digit' })
  .regex(/[^a-zA-Z0-9]/, { message: 'validation.password.symbol' });

/** Email schema (RFC-ish; the backend lowercases + trims). */
export const emailSchema = z
  .string()
  .trim()
  .min(1, { message: 'validation.email.required' })
  .email({ message: 'validation.email.invalid' });

/** Username: 3–64 chars (matches the backend `createUserSchema`). */
export const usernameSchema = z
  .string()
  .trim()
  .min(3, { message: 'validation.username.tooShort' })
  .max(64, { message: 'validation.username.tooLong' });

/** Display name: optional, max 128 (matches the backend schema). */
export const displayNameSchema = z
  .string()
  .trim()
  .max(128, { message: 'validation.displayName.tooLong' })
  .optional();

/**
 * Password + confirmation pair. Validates that the two fields match and
 * returns the single `password` value on success.
 */
export const passwordWithConfirmSchema = z
  .object({
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'validation.password.mismatch',
    path: ['confirmPassword'],
  });

// ── Asset CRUD schemas ───────────────────────────────────────────────────────
//
// zod schemas for the Asset Management create/edit forms. Messages are i18n
// keys translated via `t()`. Required fields use `min(1)` with a `.required`
// message; enums validate against the domain status/type unions.

/** Required non-empty trimmed string. */
const reqStr = (key: string) =>
  z
    .string()
    .trim()
    .min(1, { message: key });

/** Vehicle create/edit form (CreateVehiclePayload). */
export const vehicleSchema = z.object({
  licensePlate: reqStr('validation.vehicle.plate.required'),
  vin: z
    .string()
    .trim()
    .min(1, { message: 'validation.vehicle.vin.required' })
    .length(17, { message: 'validation.vehicle.vin.length' }),
  make: reqStr('validation.vehicle.make.required'),
  model: reqStr('validation.vehicle.model.required'),
  year: z
    .number()
    .int()
    .min(1900, { message: 'validation.vehicle.year.invalid' })
    .max(new Date().getFullYear() + 1, { message: 'validation.vehicle.year.invalid' }),
  type: z.enum(['truck', 'van', 'bus', 'car']),
  fuelType: z.enum(['diesel', 'gasoline', 'electric', 'hybrid', 'cng', 'lpg']),
  color: z.string().trim().optional().default(''),
  status: z.enum(['active', 'inactive', 'maintenance', 'decommissioned', 'sold']),
  groupId: z.string().optional(),
  deviceId: z.string().optional(),
});

/** Driver create/edit form (CreateDriverPayload). */
export const driverSchema = z.object({
  firstName: reqStr('validation.driver.firstName.required'),
  lastName: reqStr('validation.driver.lastName.required'),
  email: emailSchema,
  phone: reqStr('validation.driver.phone.required'),
  employeeId: z.string().trim().optional(),
  status: z.enum(['active', 'inactive', 'suspended', 'terminated']),
  licenseNumber: reqStr('validation.driver.licenseNumber.required'),
  licenseClass: reqStr('validation.driver.licenseClass.required'),
  licenseExpiry: reqStr('validation.driver.licenseExpiry.required'),
  assignedVehicleId: z.string().optional(),
});

/** Device create/edit form (CreateDevicePayload). */
export const deviceSchema = z.object({
  serialNumber: reqStr('validation.device.serial.required'),
  deviceType: z.enum(['obd2', 'gps_tracker', 'dashcam', 'custom_sensor']),
  manufacturer: reqStr('validation.device.manufacturer.required'),
  model: reqStr('validation.device.model.required'),
  imei: z
    .string()
    .trim()
    .length(15, { message: 'validation.device.imei.length' })
    .optional()
    .or(z.literal('')),
  firmwareVersion: reqStr('validation.device.firmware.required'),
  reportingIntervalSec: z
    .number()
    .int()
    .min(1, { message: 'validation.device.interval.invalid' })
    .max(86_400, { message: 'validation.device.interval.invalid' }),
  status: z.enum(['provisioned', 'active', 'inactive', 'firmware_updating', 'faulted', 'decommissioned']),
  boundVehicleId: z.string().optional(),
});

/** Group create/edit form (CreateGroupPayload). */
export const groupSchema = z.object({
  name: reqStr('validation.group.name.required'),
  description: z.string().trim().optional().default(''),
  vehicleTypeFilter: z.enum(['truck', 'van', 'bus', 'car']).optional(),
  status: z.enum(['active', 'archived']),
});

