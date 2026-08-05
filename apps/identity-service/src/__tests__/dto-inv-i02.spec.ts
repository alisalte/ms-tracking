import { describe, expect, it } from '@jest/globals';
import {
  createApiKeySchema,
  createUserSchema,
  loginSchema,
  refreshSchema,
} from '../api/auth/auth.dto.js';

/**
 * INV-I02 / ARR SEC-2: tenant_id must NEVER appear in a client-facing request
 * schema. It is always derived from the verified JWT. This test pins the
 * contract — if a future DTO accidentally accepts tenant_id, this breaks the
 * build (and the CI drift gate).
 */
describe('INV-I02: tenant_id is forbidden in request DTOs', () => {
  it('login schema rejects tenant_id', () => {
    const result = loginSchema.safeParse({ email: 'a@b.com', password: 'x', tenant_id: 't1' });
    // tenant_id is stripped (not in schema) — zod default is to strip unknown keys.
    // We assert it is NOT in the parsed output.
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty('tenant_id');
    }
  });

  it('createUser schema strips tenant_id', () => {
    const result = createUserSchema.safeParse({
      email: 'a@b.com',
      username: 'alice',
      password: 'StrongPass123!',
      tenant_id: 't1',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty('tenant_id');
    }
  });

  it('refresh schema strips tenant_id', () => {
    const result = refreshSchema.safeParse({ refresh_token: 'tok', tenant_id: 't1' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty('tenant_id');
    }
  });

  it('createApiKey schema strips tenant_id', () => {
    const result = createApiKeySchema.safeParse({
      name: 'ci',
      scopes: ['iam.user.read'],
      tenant_id: 't1',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty('tenant_id');
    }
  });
});
