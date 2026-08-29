import { beforeEach, describe, expect, it } from 'vitest';

import {
  clearTokens,
  getStoredTokens,
  getTenantId,
  getTenantName,
  saveTenantId,
  saveTenantName,
  saveTokens,
} from '@/auth/token.storage';

describe('Token storage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('saves and retrieves tokens', () => {
    saveTokens({ accessToken: 'access-123', refreshToken: 'refresh-456', tenantId: 'tenant-789' });
    const stored = getStoredTokens();
    expect(stored).not.toBeNull();
    expect(stored?.accessToken).toBe('access-123');
    expect(stored?.refreshToken).toBe('refresh-456');
    expect(stored?.tenantId).toBe('tenant-789');
  });

  it('saves and retrieves tenant ID independently', () => {
    saveTenantId('tenant-abc');
    expect(getTenantId()).toBe('tenant-abc');
  });

  it('returns null when no tokens are stored', () => {
    expect(getStoredTokens()).toBeNull();
  });

  it('returns null when stored tokens are corrupted JSON', () => {
    localStorage.setItem('fleetvision_tokens', '{not json');
    expect(getStoredTokens()).toBeNull();
  });

  it('returns null for tenant ID when not set', () => {
    expect(getTenantId()).toBeNull();
  });

  it('clears all tokens', () => {
    saveTokens({ accessToken: 'a', refreshToken: 'r', tenantId: 't' });
    saveTenantId('t');
    saveTenantName('FleetVision');
    clearTokens();
    expect(getStoredTokens()).toBeNull();
    expect(getTenantId()).toBeNull();
    expect(getTenantName()).toBeNull();
  });
});
