import { describe, expect, it } from 'vitest';

import { displayLabel, isUuid } from '@/lib/ids';

describe('displayLabel', () => {
  it('uses a human title when the id is a GUID', () => {
    expect(displayLabel('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'FleetVision')).toBe('FleetVision');
  });

  it('hides a GUID when no title is available', () => {
    expect(displayLabel('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')).toBeNull();
  });

  it('keeps a non-UUID id even if a title is also present', () => {
    expect(displayLabel('TR-5000', 'Truck 7')).toBe('TR-5000');
    expect(displayLabel('tenant-1')).toBe('tenant-1');
  });

  it('treats a UUID title as missing', () => {
    expect(isUuid('b3bbcd42-1111-4111-8111-c8523f6ce238')).toBe(true);
    expect(
      displayLabel('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'b3bbcd42-1111-4111-8111-c8523f6ce238'),
    ).toBeNull();
  });
});
