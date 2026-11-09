import { describe, expect, it } from '@jest/globals';
import {
  boundsFromExtent,
  isValidTile,
  nativeZoom,
  signTileToken,
  tileBounds,
  tileTokenExpiry,
  verifyTileToken,
} from '../domain/orthophoto.js';

const claims = { tenantId: 'tenant-a', orthophotoId: 'photo-1', exp: 2_000 };

describe('orthophoto tile tokens', () => {
  it('round-trips valid claims', () => {
    expect(verifyTileToken('secret', signTileToken('secret', claims), 1_000)).toEqual(claims);
  });

  it('rejects expired tokens, wrong secrets and tampered tenants', () => {
    const token = signTileToken('secret', claims);
    expect(verifyTileToken('secret', token, 2_000)).toBeNull();
    expect(verifyTileToken('other', token, 1_000)).toBeNull();
    const forged = Buffer.from('tenant-b.photo-1.2000').toString('base64url');
    expect(verifyTileToken('secret', `${forged}.${token.split('.')[1]}`, 1_000)).toBeNull();
    expect(verifyTileToken('secret', 'garbage', 1_000)).toBeNull();
  });

  it('keeps the expiry stable within a day', () => {
    expect(tileTokenExpiry(86_400)).toBe(tileTokenExpiry(172_799));
    expect(tileTokenExpiry(86_400)).toBeGreaterThan(86_400 + 86_399);
  });
});

describe('orthophoto tile maths', () => {
  it('validates tile coordinates', () => {
    expect(isValidTile(2, 3, 3)).toBe(true);
    expect(isValidTile(2, 4, 0)).toBe(false);
    expect(isValidTile(1.5, 0, 0)).toBe(false);
    expect(isValidTile(27, 0, 0)).toBe(false);
  });

  it('computes mercator bounds', () => {
    const b = tileBounds(1, 1, 0);
    expect(b.minX).toBeCloseTo(0);
    expect(b.maxY).toBeCloseTo(20037508.342789244);
    expect(b.minY).toBeCloseTo(0);
  });

  it('maps pixel size to zoom', () => {
    expect(nativeZoom(156543.03392804097)).toBe(0);
    expect(nativeZoom(0.0746)).toBe(21);
  });

  it('derives bounds from a GDAL extent and rejects bad input', () => {
    expect(
      boundsFromExtent({
        coordinates: [
          [
            [51, 35],
            [52, 35],
            [52, 36],
            [51, 36],
            [51, 35],
          ],
        ],
      }),
    ).toEqual({ minLng: 51, minLat: 35, maxLng: 52, maxLat: 36 });
    expect(boundsFromExtent(null)).toBeNull();
  });
});
