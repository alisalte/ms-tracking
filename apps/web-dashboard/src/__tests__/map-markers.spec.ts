import { describe, expect, it } from 'vitest';

import { headingArrowDataUrl, inferVehicleType, vehicleMarkerSvg } from '@/lib/map-markers';

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

  it('vehicleMarkerSvg returns a flat fleet-vector SVG per type without cartoon chrome', () => {
    for (const t of ['car', 'van', 'truck', 'bus'] as const) {
      const svg = vehicleMarkerSvg(t, '#12B76A', { heading: 45, id: t });
      expect(svg).toContain('linearGradient');
      expect(svg).not.toContain('feDropShadow');
      expect(svg).not.toContain('#7DD3FC');
      expect(svg).not.toContain('#FEF9C3');
      expect(svg).toContain('#0F172A');
      expect(svg).toContain('rotate(45 32 32)');
    }
  });

  it('unselected markers use a white sticker stroke', () => {
    const svg = vehicleMarkerSvg('car', '#12B76A', { id: 'stk' });
    expect(svg).toContain('stroke="#FFFFFF"');
  });

  it('selection uses a white hull stroke, not a circular halo or pin', () => {
    const svg = vehicleMarkerSvg('van', '#98A2B3', { selected: true, id: 'sel' });
    expect(svg).not.toContain('r="27"');
    expect(svg).not.toContain('r="30"');
    expect(svg).not.toContain('M32 64 L26 54 H38 Z');
    expect(svg).toContain('stroke="#F8FAFC"');
  });

  it('headingArrowDataUrl uses the same vehicle body', () => {
    const url = headingArrowDataUrl('#06B6D4', 90);
    expect(url).toMatch(/^data:image\/svg\+xml;charset=utf-8,/);
    const svg = decodeURIComponent(url.split(',')[1] ?? '');
    expect(svg).toContain('-body');
    expect(svg).toContain('rotate(90 32 32)');
  });
});
