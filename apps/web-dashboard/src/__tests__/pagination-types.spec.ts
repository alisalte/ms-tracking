import { describe, expect, it } from 'vitest';

import type { Page } from '@/types/api.types';

/**
 * Sprint 3: the Page<T> type matches the backend cursor-paginated response
 * shape ({ data, nextCursor }). The cursor pagination hook reads this shape.
 */
describe('Page<T> type matches backend shape', () => {
  it('has data + nextCursor fields', () => {
    const page: Page<string> = { data: ['a', 'b'], nextCursor: 'cursor123' };
    expect(page.data).toEqual(['a', 'b']);
    expect(page.nextCursor).toBe('cursor123');
  });

  it('nextCursor is null when the page is exhausted', () => {
    const page: Page<number> = { data: [1, 2, 3], nextCursor: null };
    expect(page.nextCursor).toBeNull();
  });
});
