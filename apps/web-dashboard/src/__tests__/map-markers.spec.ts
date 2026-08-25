import { describe, expect, it } from 'vitest';

import { inferVehicleType, vehicleMarkerDataUrl } from '@/lib/map-markers';

describe('inferVehicleType', () => {
  it('classifies passenger cars (سواری)', () => {
    expect(inferVehicleType('سواری سازمانی پژو ۲۰۶ Peugeot 22')).toBe('car');
    expect(inferVehicleType('Peugeot 206 SD')).toBe('car');
  });

  it('classifies vans / pickups (وانت)', () => {
    expect(inferVehicleType('وانت نیسان Nissan 22')).toBe('van');
    expect(inferVehicleType('کامیونت فوتون Foton 22')).toBe('van');
  });

  it('classifies heavy trucks (سنگین)', () => {
    expect(inferVehicleType('خاور Khavar 66')).toBe('truck');
    expect(inferVehicleType('بنز آکتروس Actros 22')).toBe('truck');
    expect(inferVehicleType('ولوو FH Volvo 77')).toBe('truck');
    expect(inferVehicleType('ایسوزو NPR Isuzu 22')).toBe('truck');
  });

  it('classifies buses', () => {
    expect(inferVehicleType('مینی‌بوس ایسوزو Isuzu 22')).toBe('bus');
  });

  it('defaults unknown labels to car', () => {
    expect(inferVehicleType(undefined)).toBe('car');
    expect(inferVehicleType('')).toBe('car');
  });

  it('vehicleMarkerDataUrl returns a 3D SVG data URL per type', () => {
    for (const t of ['car', 'van', 'truck', 'bus'] as const) {
      const url = vehicleMarkerDataUrl(t, '#12B76A', { heading: 45 });
      expect(url).toMatch(/^data:image\/svg\+xml;base64,/);
      expect(atob(url.split(',')[1] ?? '')).toContain('linearGradient');
    }
  });
});
