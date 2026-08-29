import { describe, expect, it } from 'vitest';

import {
  getVehicleIcon,
  headingArrowDataUrl,
  inferVehicleType,
  markerHeading,
  paintVehicleMarker,
  vehicleMarkerSvg,
} from '@/lib/map-markers';
import { VEHICLE_TYPES } from '@/lib/vehicle-icons';

describe('inferVehicleType', () => {
  it('classifies passenger cars (سواری)', () => {
    expect(inferVehicleType('سواری سازمانی پژو ۲۰۶ Peugeot 22')).toBe('car');
    expect(inferVehicleType('Peugeot 206 SD')).toBe('car');
  });

  it('classifies vans and pickups separately', () => {
    expect(inferVehicleType('وانت نیسان Nissan 22')).toBe('pickup');
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

  it('classifies crane, excavator, motorcycle, and trailer', () => {
    expect(inferVehicleType('جرثقیل هوایی Crane')).toBe('crane');
    expect(inferVehicleType('بیل مکانیکی CAT')).toBe('excavator');
    expect(inferVehicleType('موتورسیکلت Honda')).toBe('motorcycle');
    expect(inferVehicleType('تریلی Volvo')).toBe('trailer');
  });

  it('defaults empty or unrecognized labels to unknown', () => {
    expect(inferVehicleType(undefined)).toBe('unknown');
    expect(inferVehicleType('')).toBe('unknown');
    expect(inferVehicleType('Asset-42')).toBe('unknown');
  });
});

describe('getVehicleIcon', () => {
  it('prefers an explicit registry type over the label', () => {
    expect(getVehicleIcon({ type: 'crane', label: 'سواری پژو' })).toBe('crane');
  });

  it('maps aliases and infers from name when type is missing', () => {
    expect(getVehicleIcon({ type: 'air_lifter', label: '' })).toBe('crane');
    expect(getVehicleIcon({ type: 'heavy_equipment', label: '' })).toBe('truck');
    expect(getVehicleIcon({ name: 'جرثقیل 12', label: '' })).toBe('crane');
  });

  it('falls back to unknown for garbage types with no inferable label', () => {
    expect(getVehicleIcon({ type: 'spaceship', label: '' })).toBe('unknown');
  });
});

describe('markerHeading', () => {
  it('normalizes compass degrees and keeps the last valid heading', () => {
    expect(markerHeading(90)).toBe(90);
    expect(markerHeading(450)).toBe(90);
    expect(markerHeading(-90)).toBe(270);
    expect(markerHeading(null, 42)).toBe(42);
    expect(markerHeading(Number.NaN, 12)).toBe(12);
  });
});

describe('vehicleMarkerSvg', () => {
  it('returns a flat fleet-vector SVG per catalog type without cartoon chrome', () => {
    for (const t of VEHICLE_TYPES) {
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
    expect(svg).not.toContain('r="29"');
    expect(svg).not.toContain('r="30"');
    expect(svg).not.toContain('M32 64 L26 54 H38 Z');
    expect(svg).toContain('stroke="#F8FAFC"');
  });

  it('unknown type still produces a marker (generic body)', () => {
    const svg = vehicleMarkerSvg(undefined, '#98A2B3', { id: 'unk' });
    expect(svg).toContain('linearGradient');
    expect(svg).toContain('rotate(0 32 32)');
  });

  it('alarm pip is independent of the body silhouette', () => {
    const svg = vehicleMarkerSvg('truck', '#F04438', { id: 'alm', alarm: true });
    expect(svg).toContain('r="5.2"');
    expect(vehicleMarkerSvg('truck', '#F04438', { id: 'alm' })).not.toContain('r="5.2"');
  });

  it('headingArrowDataUrl uses the same vehicle body', () => {
    const url = headingArrowDataUrl('#06B6D4', 90);
    expect(url).toMatch(/^data:image\/svg\+xml;charset=utf-8,/);
    const svg = decodeURIComponent(url.split(',')[1] ?? '');
    expect(svg).toContain('-body');
    expect(svg).toContain('rotate(90 32 32)');
  });

  it('paintVehicleMarker reuses the last valid heading when the next fix has none', () => {
    const el = document.createElement('div');
    paintVehicleMarker(el, 'car', '#12B76A', { heading: 120, id: 'h' });
    expect(el.innerHTML).toContain('rotate(120 32 32)');
    paintVehicleMarker(el, 'car', '#12B76A', { heading: null, id: 'h' });
    expect(el.innerHTML).toContain('rotate(120 32 32)');
  });
});
