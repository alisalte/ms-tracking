import { describe, expect, it } from 'vitest';

import {
  analyticsViewBounds,
  expandProjectedRect,
  projectAnalyticsOverlay,
} from '@/lib/analytics-map-geo';
import { activityColor, activityShare } from '@/lib/spatial-analytics';

describe('analyticsViewBounds', () => {
  it('frames cells, heat and points together', () => {
    const bounds = analyticsViewBounds({
      cells: [{ south: 29.6, west: 52.5, north: 29.61, east: 52.51 }],
      heat: [{ lat: 29.7, lng: 52.6 }],
      points: [{ lat: 29.55, lng: 52.45 }],
    });
    expect(bounds).toEqual([
      [52.45, 29.55],
      [52.6, 29.7],
    ]);
  });

  it('ignores a hull that sits in a different place than the cells', () => {
    const bounds = analyticsViewBounds({
      cells: [{ south: 29.59, west: 52.53, north: 29.62, east: 52.58 }],
      hull: [
        { lat: 35.7, lng: 51.3 },
        { lat: 35.8, lng: 51.4 },
        { lat: 35.75, lng: 51.5 },
      ],
    });
    expect(bounds?.[0][1]).toBeCloseTo(29.59, 2);
    expect(bounds?.[1][1]).toBeCloseTo(29.62, 2);
    expect(bounds?.[0][0]).toBeGreaterThan(52);
  });

  it('uses the hull when it is the only geometry', () => {
    const bounds = analyticsViewBounds({
      hull: [
        { lat: 32.6, lng: 51.6 },
        { lat: 32.7, lng: 51.7 },
        { lat: 32.65, lng: 51.8 },
      ],
    });
    expect(bounds).toEqual([
      [51.6, 32.6],
      [51.8, 32.7],
    ]);
  });

  it('drops coordinates that are not a real lat/lng', () => {
    expect(
      analyticsViewBounds({
        points: [{ lat: 250, lng: 51 }],
        cells: [{ south: 0, west: 0, north: 40, east: 40 }],
      }),
    ).toBeNull();
  });
});

describe('projectAnalyticsOverlay', () => {
  const identity = (lng: number, lat: number) => ({ x: lng, y: lat });

  it('paints a cell in its legend color and keeps sub-pixel cells visible', () => {
    const overlay = projectAnalyticsOverlay(
      {
        cells: [
          {
            south: 10,
            west: 20,
            north: 10.2,
            east: 20.2,
            color: '#12B76A',
            opacity: 0.55,
          },
          {
            south: 30,
            west: 40,
            north: 30.0001,
            east: 40.0001,
            color: '#F04438',
            opacity: 0.78,
          },
        ],
      },
      identity,
      { w: 100, h: 100 },
    );
    expect(overlay?.cells).toHaveLength(2);
    expect(overlay?.cells[0]).toMatchObject({ color: '#12B76A', opacity: 0.55 });
    const grown = expandProjectedRect(20, 10, 20.2, 10.2);
    expect(grown.x2 - grown.x1).toBeGreaterThanOrEqual(8);
    expect(overlay?.cells[0]?.points.startsWith(`${grown.x1},${grown.y1}`)).toBe(true);
    const tiny = expandProjectedRect(40, 30, 40.0001, 30.0001);
    expect(tiny.x2 - tiny.x1).toBeGreaterThanOrEqual(8);
    expect(overlay?.cells[1]?.points.startsWith(`${tiny.x1},${tiny.y1}`)).toBe(true);
  });

  it('draws the project outline and ranked stops', () => {
    const overlay = projectAnalyticsOverlay(
      {
        hull: [
          { lat: 10, lng: 10 },
          { lat: 10, lng: 30 },
          { lat: 30, lng: 20 },
        ],
        points: [{ lat: 12, lng: 14, color: '#F79009', label: '1' }],
      },
      identity,
      { w: 80, h: 80 },
    );
    expect(overlay?.hull).toBe('10,10 30,10 20,30');
    expect(overlay?.points[0]).toMatchObject({ x: 14, y: 12, r: 11, color: '#F79009' });
  });
});

describe('activity color ramp', () => {
  it('matches the movement legend stops', () => {
    expect(activityColor(0)).toBe('rgb(6, 182, 212)');
    expect(activityColor(0.5)).toBe('rgb(253, 176, 34)');
    expect(activityColor(1)).toBe('rgb(240, 68, 56)');
    expect(activityShare(0, 10)).toBe(0);
    expect(activityShare(10, 10)).toBe(1);
  });
});

describe('analyticsViewBounds outliers', () => {
  const cluster = Array.from({ length: 60 }, (_, i) => ({
    south: 35.7 + (i % 10) * 0.002,
    north: 35.7 + (i % 10) * 0.002 + 0.002,
    west: 51.4 + Math.floor(i / 10) * 0.002,
    east: 51.4 + Math.floor(i / 10) * 0.002 + 0.002,
  }));

  it('ignores a stray far-away cell and alarm when there are many items', () => {
    const bounds = analyticsViewBounds({
      cells: [...cluster, { south: 29.0, west: 52.0, north: 29.002, east: 52.002 }],
      points: [{ lat: 40, lng: 45 }],
    });
    expect(bounds?.[0][1]).toBeGreaterThan(35.6);
    expect(bounds?.[1][1]).toBeLessThan(35.8);
    expect(bounds?.[0][0]).toBeGreaterThan(51.3);
    expect(bounds?.[1][0]).toBeLessThan(51.5);
  });

  it('keeps every item when the set is small', () => {
    const bounds = analyticsViewBounds({
      cells: [
        { south: 35.7, west: 51.4, north: 35.702, east: 51.402 },
        { south: 29.0, west: 52.0, north: 29.002, east: 52.002 },
      ],
    });
    expect(bounds?.[0][1]).toBe(29.0);
    expect(bounds?.[1][1]).toBe(35.702);
  });
});
