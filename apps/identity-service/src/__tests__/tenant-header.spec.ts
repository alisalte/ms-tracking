import { describe, expect, it } from '@jest/globals';
import { tenantHeaderCandidates } from '../api/auth/tenant-header.js';

describe('tenantHeaderCandidates', () => {
  it('returns a trimmed ASCII name', () => {
    expect(tenantHeaderCandidates('  FleetVision  ')).toEqual(['FleetVision']);
  });

  it('decodes a percent-encoded Persian organization name', () => {
    const name = 'شرکت سامان';
    expect(tenantHeaderCandidates(encodeURIComponent(name))).toEqual([
      encodeURIComponent(name),
      name,
    ]);
  });

  it('recovers UTF-8 that Node stored as latin1 header bytes', () => {
    const name = 'شرکت سامان';
    const mojibake = Buffer.from(name, 'utf8').toString('latin1');
    expect(tenantHeaderCandidates(mojibake)).toContain(name);
  });

  it('leaves a UUID unchanged', () => {
    const id = '7565152f-96c4-49ca-ac9b-7a7b7db63a16';
    expect(tenantHeaderCandidates(id)).toEqual([id]);
  });

  it('returns empty for a missing header', () => {
    expect(tenantHeaderCandidates(undefined)).toEqual([]);
    expect(tenantHeaderCandidates('   ')).toEqual([]);
  });
});
