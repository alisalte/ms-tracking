/**
 * Auth DTOs (zod schemas). Note: `tenant_id` is intentionally ABSENT from every
 * schema — INV-I02 / ARR SEC-2 forbid tenant_id in client-facing request
 * schemas; it is always derived from the verified JWT. A test pins this.
 */
import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type LoginDto = z.infer<typeof loginSchema>;

export const refreshSchema = z.object({
  refresh_token: z.string().min(1),
});
export type RefreshDto = z.infer<typeof refreshSchema>;

export const changeUserStatusSchema = z.object({
  status: z.enum(['active', 'suspended', 'deactivated']),
  reason: z.string().max(256).optional(),
});
export type ChangeUserStatusDto = z.infer<typeof changeUserStatusSchema>;

export const createUserSchema = z.object({
  email: z.string().email(),
  username: z.string().min(3).max(64),
  password: z.string().min(12),
  display_name: z.string().max(128).optional(),
});
export type CreateUserDto = z.infer<typeof createUserSchema>;

export const licensePlanCodeSchema = z.enum([
  'TRIAL',
  'STANDARD',
  'PROFESSIONAL',
  'ENTERPRISE',
  'CUSTOM',
]);

export const tenantLicenseFieldsSchema = z.object({
  plan_code: licensePlanCodeSchema.optional(),
  starts_at: z.string().min(8).max(40).optional(),
  expires_at: z.string().min(8).max(40).optional(),
  grace_days: z.number().int().min(0).max(90).optional(),
  max_users: z.number().int().min(1).max(100_000).optional(),
  max_vehicles: z.number().int().min(1).max(1_000_000).optional(),
  max_devices: z.number().int().min(1).max(1_000_000).optional(),
  max_drivers: z.number().int().min(1).max(1_000_000).optional(),
  max_storage_bytes: z.number().int().min(0).optional(),
  max_download_bytes_month: z.number().int().min(0).optional(),
  max_concurrent_sessions: z.number().int().min(1).max(10_000).optional(),
  session_idle_minutes: z
    .number()
    .int()
    .min(5)
    .max(24 * 60)
    .optional(),
  session_absolute_hours: z
    .number()
    .int()
    .min(1)
    .max(24 * 30)
    .optional(),
  login_hours_start: z.number().int().min(0).max(23).nullable().optional(),
  login_hours_end: z.number().int().min(0).max(23).nullable().optional(),
  timezone: z.string().trim().min(1).max(64).optional(),
  notes: z.string().max(2000).nullable().optional(),
  features: z.record(z.unknown()).optional(),
  currency: z.string().trim().min(3).max(8).optional(),
  base_price: z.number().int().min(0).optional(),
  unit_price_users: z.number().int().min(0).optional(),
  unit_price_vehicles: z.number().int().min(0).optional(),
  unit_price_devices: z.number().int().min(0).optional(),
  unit_price_drivers: z.number().int().min(0).optional(),
  unit_price_storage_gib: z.number().int().min(0).optional(),
  unit_price_download_gib: z.number().int().min(0).optional(),
});
export type TenantLicenseFieldsDto = z.infer<typeof tenantLicenseFieldsSchema>;

export const provisionTenantSchema = z.object({
  name: z.string().trim().min(2).max(128),
  tier: z.enum(['STANDARD', 'PROFESSIONAL', 'ENTERPRISE']),
  region: z.string().trim().min(2).max(64),
  admin_email: z.string().email(),
  admin_username: z.string().min(3).max(64),
  admin_password: z.string().min(12),
  license: tenantLicenseFieldsSchema.optional(),
});
export type ProvisionTenantDto = z.infer<typeof provisionTenantSchema>;

export const putTenantLicenseSchema = tenantLicenseFieldsSchema;
export type PutTenantLicenseDto = TenantLicenseFieldsDto;

export const putTenantUsageSchema = z.object({
  storage_bytes: z.number().int().min(0).optional(),
  download_bytes_month: z.number().int().min(0).optional(),
});
export type PutTenantUsageDto = z.infer<typeof putTenantUsageSchema>;

export const generateInvoiceSchema = z.object({
  due_days: z.number().int().min(0).max(365).optional(),
  tax_rate: z.number().min(0).max(1).optional(),
  notes: z.string().max(2000).nullable().optional(),
});
export type GenerateInvoiceDto = z.infer<typeof generateInvoiceSchema>;

export const createTenantAccessSchema = createUserSchema.extend({
  role_name: z.enum(['tenant-admin', 'fleet-admin', 'viewer']).default('viewer'),
});
export type CreateTenantAccessDto = z.infer<typeof createTenantAccessSchema>;

export const createApiKeySchema = z.object({
  name: z.string().min(1).max(128),
  scopes: z.array(z.string()).min(1),
  assigned_user_id: z.string().uuid().nullable().optional(),
  expires_at: z.string().datetime().nullable().optional(),
});
export type CreateApiKeyDto = z.infer<typeof createApiKeySchema>;
