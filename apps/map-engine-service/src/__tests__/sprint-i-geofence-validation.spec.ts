/**
 * Geofence input validation tests (Sprint I §61 GEOFENCE 3/4/6 + §56).
 * PostGIS-authoritative geometric validity (self-intersection) is exercised
 * by the integration spec with a real database.
 */
import { describe, expect, it } from '@jest/globals';
import {
  GeofenceValidationError,
  MAX_RADIUS_METERS,
  validateAlertOn,
  validateBoundaryGeoJson,
  validateCircleInput,
  validatePolygonRing,
  validateStatus,
} from '../domain/geofence-validation.js';

const TRIANGLE = (n = 1): number[][] => [
  [51.4, 35.7],
  [51.41, 35.7],
  [51.41, 35.71 + (n - 1) * 0.001],
  [51.4, 35.7], // closure
];

describe('validateCircleInput (§7/§56)', () => {
  it('accepts boundary coordinates (±90 / ±180 included)', () => {
    expect(() =>
      validateCircleInput({ latitude: -90, longitude: -180, radiusMeters: 10 }),
    ).not.toThrow();
    expect(() =>
      validateCircleInput({ latitude: 90, longitude: 180, radiusMeters: 10 }),
    ).not.toThrow();
    expect(() => validateCircleInput({ latitude: 0, longitude: 0, radiusMeters: 1 })).not.toThrow();
  });

  it('rejects out-of-range coordinates (91 / -91 / 181 / -181)', () => {
    expect(() => validateCircleInput({ latitude: 91, longitude: 0, radiusMeters: 10 })).toThrow(
      GeofenceValidationError,
    );
    expect(() => validateCircleInput({ latitude: -91, longitude: 0, radiusMeters: 10 })).toThrow(
      GeofenceValidationError,
    );
    expect(() => validateCircleInput({ latitude: 0, longitude: 181, radiusMeters: 10 })).toThrow(
      GeofenceValidationError,
    );
    expect(() => validateCircleInput({ latitude: 0, longitude: -181, radiusMeters: 10 })).toThrow(
      GeofenceValidationError,
    );
  });

  it('rejects radius 0 / negative / NaN / oversized', () => {
    expect(() => validateCircleInput({ latitude: 0, longitude: 0, radiusMeters: 0 })).toThrow(
      /radius/,
    );
    expect(() => validateCircleInput({ latitude: 0, longitude: 0, radiusMeters: -5 })).toThrow(
      /radius/,
    );
    expect(() =>
      validateCircleInput({ latitude: 0, longitude: 0, radiusMeters: Number.NaN }),
    ).toThrow(/radius/);
    expect(() =>
      validateCircleInput({ latitude: 0, longitude: 0, radiusMeters: MAX_RADIUS_METERS + 1 }),
    ).toThrow(/cap/);
  });
});

describe('validatePolygonRing (§8/§56)', () => {
  it('accepts a closed triangle ring', () => {
    expect(() => validatePolygonRing(TRIANGLE())).not.toThrow();
  });

  it('rejects too few positions (< 4 = 3 unique + closure)', () => {
    expect(() =>
      validatePolygonRing([
        [0, 0],
        [1, 1],
        [0, 0],
      ]),
    ).toThrow(/at least 4/);
  });

  it('rejects an unclosed ring', () => {
    // 4 unique vertices WITHOUT the closing repetition — passes the length
    // gate so the closure check itself is exercised.
    const ring: number[][] = [
      [51.4, 35.7],
      [51.41, 35.7],
      [51.41, 35.71],
      [51.4, 35.71],
    ];
    expect(() => validatePolygonRing(ring)).toThrow(/closed/);
  });

  it('rejects out-of-range vertices', () => {
    const ring: number[][] = [...TRIANGLE()];
    ring[1] = [51.41, 90.5];
    expect(() => validatePolygonRing(ring)).toThrow(/out of range/);
  });

  it('rejects non-finite vertices', () => {
    const ring: number[][] = [...TRIANGLE()];
    ring[1] = [Number.NaN, 35.7];
    expect(() => validatePolygonRing(ring)).toThrow(/non-finite/);
  });
});

describe('validateBoundaryGeoJson (§9)', () => {
  it('accepts a single-ring GeoJSON Polygon', () => {
    expect(() =>
      validateBoundaryGeoJson({ type: 'Polygon', coordinates: [TRIANGLE()] }),
    ).not.toThrow();
  });

  it('rejects non-polygon shapes, holes, and wrong types', () => {
    expect(() => validateBoundaryGeoJson({ type: 'Point', coordinates: [0, 0] })).toThrow(
      GeofenceValidationError,
    );
    expect(() =>
      validateBoundaryGeoJson({ type: 'Polygon', coordinates: [TRIANGLE(), TRIANGLE()] }),
    ).toThrow(/single-ring/);
    expect(() => validateBoundaryGeoJson(null)).toThrow(GeofenceValidationError);
    expect(() => validateBoundaryGeoJson('polygon')).toThrow(GeofenceValidationError);
  });
});

describe('validateAlertOn / validateStatus', () => {
  it('accepts subsets of ENTER|EXIT|DWELL and rejects others/duplicates', () => {
    expect(() => validateAlertOn(['ENTER'])).not.toThrow();
    expect(() => validateAlertOn(['ENTER', 'EXIT', 'DWELL'])).not.toThrow();
    expect(() => validateAlertOn(['ENTER', 'ENTER'])).toThrow(/duplicate/);
    expect(() => validateAlertOn(['enter'])).toThrow(/alertOn/);
    expect(() => validateAlertOn([])).toThrow(/alertOn/);
  });

  it('accepts the three lifecycle statuses and rejects anything else', () => {
    expect(() => validateStatus('ACTIVE')).not.toThrow();
    expect(() => validateStatus('INACTIVE')).not.toThrow();
    expect(() => validateStatus('ARCHIVED')).not.toThrow();
    expect(() => validateStatus('active')).toThrow(/status/);
    expect(() => validateStatus(42 as never)).toThrow(/status/);
  });
});
