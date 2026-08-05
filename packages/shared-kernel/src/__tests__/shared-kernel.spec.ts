import { describe, expect, it } from '@jest/globals';
import { GeoPoint, Money, Result, TenantId, decodeCursor, encodeCursor, isOk } from '../index.js';

describe('shared-kernel', () => {
  describe('Money', () => {
    it('constructs valid money', () => {
      const m = Money.of('12.50', 'USD');
      expect(m.amount).toBe('12.50');
      expect(m.currency).toBe('USD');
    });

    it('rejects invalid currency codes', () => {
      expect(() => Money.of('1', 'dollars')).toThrow(/ISO 4217/);
    });

    it('two equal monies are equal', () => {
      expect(Money.of('1', 'USD').equals(Money.of('1', 'USD'))).toBe(true);
    });
  });

  describe('GeoPoint', () => {
    it('constructs valid coordinates', () => {
      const p = GeoPoint.of(40.71, -74.0);
      expect(p.latitude).toBe(40.71);
    });

    it('rejects out-of-range latitude', () => {
      expect(() => GeoPoint.of(91, 0)).toThrow(/latitude/);
    });
  });

  describe('Result', () => {
    it('ok branch carries value', () => {
      const r = Result.ok(42);
      expect(isOk(r) && r.value).toBe(42);
    });

    it('fail branch carries error', () => {
      const r = Result.failWith('NOT_FOUND', 'missing');
      expect(isOk(r)).toBe(false);
    });
  });

  describe('cursor', () => {
    it('round-trips encode/decode', () => {
      const encoded = encodeCursor({ orderBy: 'createdAt', value: '2026-01-01T00:00:00Z' });
      const decoded = decodeCursor(encoded);
      expect(decoded.orderBy).toBe('createdAt');
    });

    it('rejects tampered cursors', () => {
      expect(() => decodeCursor('!!!notbase64')).toThrow(/cursor/i);
    });
  });

  describe('TenantId', () => {
    it('builds from JWT claims', () => {
      expect(TenantId.fromJwtClaims({ tenant_id: 't-123', sub: 'u-1' })).toBe('t-123');
    });

    it('throws when tenant_id missing (INV-I02)', () => {
      expect(() => TenantId.fromJwtClaims({ sub: 'u-1' })).toThrow(/tenant_id/);
    });
  });
});
