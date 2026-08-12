import { describe, expect, it } from '@jest/globals';
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  buildPage,
  decodeCursor,
  resolvePageRequest,
  toCursor,
} from '../index.js';

/**
 * Sprint 2 pagination primitives — constants, resolvePageRequest clamping, and
 * buildPage hasMore detection. The encode/decode round-trip is covered in
 * shared-kernel.spec.ts.
 */
describe('pagination', () => {
  it('exposes sane defaults/limits', () => {
    expect(MAX_PAGE_SIZE).toBe(100);
    expect(DEFAULT_PAGE_SIZE).toBe(25);
  });

  it('resolvePageRequest clamps limit to [1, MAX_PAGE_SIZE]', () => {
    expect(resolvePageRequest({ limit: 0 }).limit).toBe(1);
    expect(resolvePageRequest({ limit: 999 }).limit).toBe(MAX_PAGE_SIZE);
    expect(resolvePageRequest({}).limit).toBe(DEFAULT_PAGE_SIZE);
    expect(resolvePageRequest({ limit: 50.7 }).limit).toBe(50);
  });

  it('resolvePageRequest decodes a cursor', () => {
    const c = toCursor('created_at', '2026-01-01', 'id-1');
    const r = resolvePageRequest({ cursor: c });
    expect(r.cursor?.orderBy).toBe('created_at');
    expect(r.cursor?.value).toBe('2026-01-01');
    expect(r.cursor?.id).toBe('id-1');
  });

  it('resolvePageRequest throws on a tampered cursor', () => {
    expect(() => resolvePageRequest({ cursor: '!!!bad' })).toThrow(/cursor/i);
  });

  it('buildPage trims to limit + sets nextCursor when hasMore', () => {
    const rows = [1, 2, 3, 4];
    const page = buildPage(rows, 3, (last) => toCursor('id', last));
    expect(page.data).toEqual([1, 2, 3]);
    expect(page.nextCursor).not.toBeNull();
  });

  it('buildPage returns null nextCursor when exhausted', () => {
    const rows = [1, 2];
    const page = buildPage(rows, 3, (last) => toCursor('id', last));
    expect(page.data).toEqual([1, 2]);
    expect(page.nextCursor).toBeNull();
  });

  it('toCursor includes the id tiebreaker', () => {
    const c = decodeCursor(toCursor('created_at', 'v', 'tie'));
    expect(c.id).toBe('tie');
  });
});
