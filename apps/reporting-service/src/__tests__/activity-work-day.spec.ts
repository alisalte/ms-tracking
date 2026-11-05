import { describe, expect, it } from '@jest/globals';
import { activitySql } from '../application/operations-report.service.js';

describe('device activity work day', () => {
  it('buckets fixes by the work day that starts at the first shift', () => {
    const sql = activitySql(420);
    expect(sql).toContain(
      "((captured_at AT TIME ZONE 'Asia/Tehran') - interval '420 minutes')::date AS day",
    );
    // The offline tail of the last day compares against the same work day.
    expect(sql).toContain(
      "WHEN p.day = ((?::timestamptz AT TIME ZONE 'Asia/Tehran') - interval '420 minutes')::date",
    );
  });

  it('keeps calendar days when the tenant has no route (midnight start)', () => {
    expect(activitySql(0)).toContain("- interval '0 minutes')::date AS day");
  });
});
