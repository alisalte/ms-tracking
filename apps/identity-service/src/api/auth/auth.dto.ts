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

export const provisionTenantSchema = z.object({
  name: z.string().trim().min(2).max(128),
  tier: z.enum(['STANDARD', 'PROFESSIONAL', 'ENTERPRISE']),
  region: z.string().trim().min(2).max(64),
  admin_email: z.string().email(),
  admin_username: z.string().min(3).max(64),
  admin_password: z.string().min(12),
});
export type ProvisionTenantDto = z.infer<typeof provisionTenantSchema>;

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
