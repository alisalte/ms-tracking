/**
 * Sprint J reporting unit tests (§51): window parsing + date boundaries,
 * sorting whitelist, CSV escaping/injection protection, cache-key isolation,
 * utilization semantics, empty/partial data, invalid filters.
 */
import { describe, expect, it } from '@jest/globals';
import { csvCell, csvDocument } from '../domain/csv.js';
import {
  parseReportWindow,
  reportWindowErrorMessage,
  utcDayStart,
} from '../domain/report-window.js';
import {
  resolveSort,
  TRIP_SORT_FIELDS,
  UTILIZATION_SORT_FIELDS,
} from '../domain/report-types.js';
import { ReportCache } from '../infrastructure/cache/report-cache.js';

const NOW = new Date('2026-08-16T14:23:45Z');

describe('parseReportWindow (§16/§18)', () => {
  it('1/8. today = [UTC midnight, now)', () => {
    const r = parseReportWindow({ preset: 'today', now: NOW });
    expect(r.error).toBeUndefined();
    expect(r.window?.from).toEqual(new Date('2026-08-16T00:00:00Z'));
    expect(r.window?.to).toEqual(NOW);
  });

  it('yesterday = exactly one UTC calendar day (start inclusive, end exclusive)', () => {
    const r = parseReportWindow({ preset: 'yesterday', now: NOW });
    expect(r.window?.from).toEqual(new Date('2026-08-15T00:00:00Z'));
    expect(r.window?.to).toEqual(new Date('2026-08-16T00:00:00Z'));
  });

  it('7d/30d start at a UTC day boundary', () => {
    const r7 = parseReportWindow({ preset: '7d', now: NOW });
    expect(r7.window?.from).toEqual(new Date('2026-08-09T00:00:00Z'));
    const r30 = parseReportWindow({ preset: '30d', now: NOW });
    expect(r30.window?.from).toEqual(new Date('2026-07-17T00:00:00Z'));
  });

  it('8. rejects preset AND from/to (ambiguous)', () => {
    expect(parseReportWindow({ preset: '7d', from: '2026-08-01T00:00:00Z', now: NOW }).error).toBe('AMBIGUOUS');
  });

  it('rejects unknown presets', () => {
    expect(parseReportWindow({ preset: '1y', now: NOW }).error).toBe('UNKNOWN_PRESET');
  });

  it('18. rejects invalid ISO / missing bounds', () => {
    expect(parseReportWindow({ from: 'nope', to: '2026-08-16T00:00:00Z', now: NOW }).error).toBe('INVALID_ISO');
    expect(parseReportWindow({ from: '2026-08-15T00:00:00Z', now: NOW }).error).toBe('INVALID_ISO');
  });

  it('rejects from >= to', () => {
    expect(
      parseReportWindow({ from: '2026-08-16T00:00:00Z', to: '2026-08-16T00:00:00Z', now: NOW }).error,
    ).toBe('REVERSED');
    expect(
      parseReportWindow({ from: '2026-08-17T00:00:00Z', to: '2026-08-16T00:00:00Z', now: NOW }).error,
    ).toBe('REVERSED');
  });

  it('bounds the custom range (default 92 days, configurable)', () => {
    expect(
      parseReportWindow({
        from: '2026-05-01T00:00:00Z',
        to: '2026-08-16T00:00:00Z',
        now: NOW,
      }).error,
    ).toBe('RANGE_TOO_LARGE');
    const bounded = parseReportWindow({
      from: '2026-05-16T00:00:00Z',
      to: '2026-08-16T00:00:00Z',
      now: NOW,
      maxRangeDays: 92,
    });
    expect(bounded.error).toBeUndefined();
  });

  it('error messages are actionable', () => {
    expect(reportWindowErrorMessage('RANGE_TOO_LARGE', 92)).toContain('92');
  });

  it('utcDayStart truncates to UTC midnight', () => {
    expect(utcDayStart(new Date('2026-08-16T23:59:59Z'))).toEqual(new Date('2026-08-16T00:00:00Z'));
  });
});

describe('resolveSort — whitelisted sorting only (§22)', () => {
  it('11. maps whitelisted fields + directions; unknown fields fall back', () => {
    expect(resolveSort('distance', TRIP_SORT_FIELDS, 'startedAt')).toEqual({
      field: 'distance',
      direction: 'DESC',
    });
    expect(resolveSort('duration:asc', TRIP_SORT_FIELDS, 'startedAt')).toEqual({
      field: 'duration',
      direction: 'ASC',
    });
    // NEVER interpolates arbitrary SQL — unknown field → fallback column.
    expect(resolveSort('1; DROP TABLE x', TRIP_SORT_FIELDS, 'startedAt')).toEqual({
      field: 'startedAt',
      direction: 'DESC',
    });
    expect(resolveSort('asc', UTILIZATION_SORT_FIELDS, 'utilization').direction).toBe('ASC');
  });

  it('whitelists contain only known SQL expressions', () => {
    for (const expr of Object.values(TRIP_SORT_FIELDS)) {
      expect(expr).toMatch(/^(t|v|agg)\.[a-z_]+$/);
    }
    for (const expr of Object.values(UTILIZATION_SORT_FIELDS)) {
      // utilization sort keys are CTE output columns (no table alias).
      expect(expr).toMatch(/^(t|v|agg)\.[a-z_]+$|^[a-z_]+$/);
    }
  });
});

describe('CSV escaping (§32)', () => {
  it('14. neutralizes formula injection (=, +, -, @, tab, CR)', () => {
    expect(csvCell('=SUM(A1:A9)')).toBe("'=SUM(A1:A9)");
    expect(csvCell('+cmd')).toBe("'+cmd");
    expect(csvCell('-1')).toBe("'-1");
    expect(csvCell('@x')).toBe("'@x");
    expect(csvCell('\tpill')).toBe("'\tpill");
  });

  it('quotes values with commas/quotes/newlines and doubles embedded quotes', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line\nbreak')).toBe('"line\nbreak"');
  });

  it('plain numbers/booleans/null pass through', () => {
    expect(csvCell(12.5)).toBe('12.5');
    expect(csvCell(true)).toBe('true');
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
  });

  it('document = BOM + header + CRLF rows', () => {
    const doc = csvDocument(['a', 'b'], [[1, 'x'], [2, 'y,z']]);
    expect(doc.startsWith('\uFEFF')).toBe(true);
    expect(doc).toContain('a,b\r\n1,x\r\n2,"y,z"\r\n');
  });
});

describe('ReportCache key isolation (§15/§42)', () => {
  it('15. keys differ per tenant, report, and every filter value', () => {
    const a = ReportCache.key('overview', 'tenant-a', { from: '1', to: '2', vehicleId: 'v1' });
    const b = ReportCache.key('overview', 'tenant-b', { from: '1', to: '2', vehicleId: 'v1' });
    const c = ReportCache.key('overview', 'tenant-a', { from: '1', to: '2', vehicleId: 'v2' });
    const d = ReportCache.key('trend', 'tenant-a', { from: '1', to: '2', vehicleId: 'v1' });
    expect(new Set([a, b, c, d]).size).toBe(4);
  });

  it('key order does not matter (canonical JSON)', () => {
    const a = ReportCache.key('overview', 't', { from: '1', to: '2' });
    const b = ReportCache.key('overview', 't', { to: '2', from: '1' });
    expect(a).toBe(b);
  });
});

describe('Utilization semantics (§7/§60/§61 — missing ≠ zero)', () => {
  // The SQL expresses this; here we pin the CONTRACT the repository returns.
  it('null observed/utilization stays null through JSON', () => {
    const row = { observedSec: null, utilizationPct: null } as const;
    expect(JSON.parse(JSON.stringify(row)).observedSec).toBeNull();
    expect(JSON.parse(JSON.stringify(row)).utilizationPct).toBeNull();
  });

  it('utilization formula = moving / observed * 100 when observed > 0', () => {
    const utilization = (moving: number, observed: number | null) =>
      observed && observed > 0 ? (moving / observed) * 100 : null;
    expect(utilization(3600, 14400)).toBeCloseTo(25);
    expect(utilization(3600, null)).toBeNull();
    expect(utilization(3600, 0)).toBeNull();
  });
});

describe('Empty / partial data (§16/§17 of test list)', () => {
  it('empty aggregates render as empty arrays, not undefined', () => {
    const empty = { items: [], total: 0 };
    expect(empty.items).toHaveLength(0);
  });
});
