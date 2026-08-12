import { describe, expect, it } from '@jest/globals';
import { assignRoleSchema, provisionTenantSchema, updateUserSchema } from '../api/auth/auth.dto.js';

/**
 * Validation (Sprint 1 requirement 8): the new Zod schemas for the previously
 * raw-@Body() endpoints must accept valid input, reject invalid input, and never
 * accept a tenant_id field (INV-I02).
 */
describe('auth DTO validation (update/assignRole/provisionTenant)', () => {
  describe('updateUserSchema', () => {
    it('accepts an email-only update', () => {
      const r = updateUserSchema.safeParse({ email: 'new@b.com' });
      expect(r.success).toBe(true);
    });
    it('accepts a display_name-only update', () => {
      const r = updateUserSchema.safeParse({ display_name: 'Alice' });
      expect(r.success).toBe(true);
    });
    it('rejects an empty update (no fields)', () => {
      const r = updateUserSchema.safeParse({});
      expect(r.success).toBe(false);
    });
    it('rejects an invalid email', () => {
      const r = updateUserSchema.safeParse({ email: 'not-an-email' });
      expect(r.success).toBe(false);
    });
    it('strips tenant_id (INV-I02)', () => {
      const r = updateUserSchema.safeParse({ display_name: 'A', tenant_id: 't1' });
      expect(r.success).toBe(true);
      if (r.success) expect(r.data).not.toHaveProperty('tenant_id');
    });
  });

  describe('assignRoleSchema', () => {
    it('accepts a valid uuid', () => {
      const r = assignRoleSchema.safeParse({ role_id: '11111111-1111-1111-1111-111111111111' });
      expect(r.success).toBe(true);
    });
    it('rejects a non-uuid', () => {
      const r = assignRoleSchema.safeParse({ role_id: 'not-a-uuid' });
      expect(r.success).toBe(false);
    });
    it('rejects a missing role_id', () => {
      const r = assignRoleSchema.safeParse({});
      expect(r.success).toBe(false);
    });
    it('strips tenant_id (INV-I02)', () => {
      const r = assignRoleSchema.safeParse({
        role_id: '11111111-1111-1111-1111-111111111111',
        tenant_id: 't1',
      });
      expect(r.success).toBe(true);
      if (r.success) expect(r.data).not.toHaveProperty('tenant_id');
    });
  });

  describe('provisionTenantSchema', () => {
    const valid = {
      name: 'Acme',
      tier: 'STANDARD',
      region: 'us-east',
      admin_email: 'admin@acme.com',
      admin_username: 'admin',
      admin_password: 'StrongPass123!',
    };
    it('accepts a valid body', () => {
      expect(provisionTenantSchema.safeParse(valid).success).toBe(true);
    });
    it('rejects an unknown tier', () => {
      expect(provisionTenantSchema.safeParse({ ...valid, tier: 'FREE' }).success).toBe(false);
    });
    it('rejects a short admin_password (<12)', () => {
      expect(provisionTenantSchema.safeParse({ ...valid, admin_password: 'short' }).success).toBe(
        false,
      );
    });
    it('rejects an invalid admin_email', () => {
      expect(provisionTenantSchema.safeParse({ ...valid, admin_email: 'x' }).success).toBe(false);
    });
    it('strips tenant_id (INV-I02)', () => {
      const r = provisionTenantSchema.safeParse({ ...valid, tenant_id: 't1' });
      expect(r.success).toBe(true);
      if (r.success) expect(r.data).not.toHaveProperty('tenant_id');
    });
  });
});
