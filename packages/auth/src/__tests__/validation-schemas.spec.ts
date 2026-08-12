import { describe, expect, it } from '@jest/globals';
import { pageRequestSchema, uuidParamSchema } from '../validation-schemas.js';

/**
 * Sprint 2 validation: the shared pageRequestSchema clamps/coerces limit + cursor,
 * and uuidParamSchema validates :id path params. These are used by every
 * paginated/parametrized endpoint.
 */
describe('pageRequestSchema', () => {
  it('defaults limit when omitted', () => {
    const r = pageRequestSchema.safeParse({});
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.limit).toBe(25);
  });

  it('coerces a string limit', () => {
    const r = pageRequestSchema.safeParse({ limit: '10' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.limit).toBe(10);
  });

  it('clamps limit above MAX (100)', () => {
    const r = pageRequestSchema.safeParse({ limit: 500 });
    expect(r.success).toBe(false);
  });

  it('rejects a non-positive limit', () => {
    expect(pageRequestSchema.safeParse({ limit: 0 }).success).toBe(false);
    expect(pageRequestSchema.safeParse({ limit: -5 }).success).toBe(false);
  });

  it('accepts an opaque cursor', () => {
    const r = pageRequestSchema.safeParse({ cursor: 'YWJj' });
    expect(r.success).toBe(true);
  });

  it('rejects an empty cursor', () => {
    expect(pageRequestSchema.safeParse({ cursor: '' }).success).toBe(false);
  });
});

describe('uuidParamSchema', () => {
  it('accepts a canonical UUID', () => {
    expect(uuidParamSchema.safeParse({ id: '11111111-1111-1111-1111-111111111111' }).success).toBe(
      true,
    );
  });

  it('rejects a non-UUID', () => {
    expect(uuidParamSchema.safeParse({ id: 'not-a-uuid' }).success).toBe(false);
  });

  it('rejects a missing id', () => {
    expect(uuidParamSchema.safeParse({}).success).toBe(false);
  });
});
