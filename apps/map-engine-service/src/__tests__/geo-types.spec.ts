import { describe, expect, it } from '@jest/globals';
import { parseBbox } from '../domain/geo-types.js';

describe('parseBbox (08 §5)', () => {
  it('parses a valid bbox string', () => {
    const bb = parseBbox('113.4,22.9,113.5,23.0');
    expect(bb).toEqual({ minLng: 113.4, minLat: 22.9, maxLng: 113.5, maxLat: 23.0 });
  });

  it('returns null for an invalid bbox', () => {
    expect(parseBbox('invalid')).toBeNull();
    expect(parseBbox('1,2,3')).toBeNull();
    expect(parseBbox('a,b,c,d')).toBeNull();
  });

  it('handles negative coordinates (western/southern hemispheres)', () => {
    const bb = parseBbox('-122.5,37.7,-122.3,37.8');
    expect(bb).toEqual({ minLng: -122.5, minLat: 37.7, maxLng: -122.3, maxLat: 37.8 });
  });
});
