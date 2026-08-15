import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from '@jest/globals';

/**
 * Sprint 1 requirements 1 & 2 (ported to the merged line's architecture): the
 * gps-engine controllers must derive tenantId from the VERIFIED credential —
 * never from a client-supplied `tenant-id` header/query (spoofable; INV-I02).
 * This line's mechanism is the `@CurrentTenant()` param decorator (the global
 * CompositeAuthGuard attaches the authenticated context; the decorator reads
 * the tenant from it), so we pin the source-level contract on that.
 */
function source(rel: string): string {
  return readFileSync(resolve(process.cwd(), rel), 'utf8');
}

describe('gps-engine controllers derive tenantId from the principal', () => {
  it('PositionsController uses @CurrentTenant and never a client tenant header', () => {
    const src = source('src/api/positions.controller.ts');
    expect(src).toMatch(/@CurrentTenant\(\)/);
    expect(src).not.toMatch(/headers\[.tenant-id.\]/);
    expect(src).not.toMatch(/query\[.tenant-id.\]/);
    expect(src).not.toMatch(/X-Tenant-Id/);
  });

  it('DeviceStatusController uses @CurrentTenant and never a client tenant header', () => {
    const src = source('src/api/device-status.controller.ts');
    expect(src).toMatch(/@CurrentTenant\(\)/);
    expect(src).not.toMatch(/headers\[.tenant-id.\]/);
    expect(src).not.toMatch(/query\[.tenant-id.\]/);
    expect(src).not.toMatch(/X-Tenant-Id/);
  });
});
