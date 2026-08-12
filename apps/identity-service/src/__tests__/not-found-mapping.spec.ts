import { HttpStatusByCode } from '@fleetvision/shared-kernel';
import { describe, expect, it } from '@jest/globals';
import { NotFoundError } from '../domain/errors.js';

/**
 * Sprint 1 requirement 9: GET /iam/users/:id must return 404 (not {data:null}).
 * The NotFoundError domain error carries code='NOT_FOUND' which the
 * GlobalExceptionFilter maps to HTTP 404.
 */
describe('NotFoundError maps to 404', () => {
  it('carries the NOT_FOUND code', () => {
    const err = new NotFoundError('User');
    expect(err.code).toBe('NOT_FOUND');
  });
  it('NOT_FOUND maps to HTTP 404 via HttpStatusByCode', () => {
    expect(HttpStatusByCode.NOT_FOUND).toBe(404);
  });
  it('message is generic (no tenant data leakage)', () => {
    const err = new NotFoundError('User');
    expect(err.message).toBe('User not found.');
    // Must not leak tenant ids / emails.
    expect(err.message).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
  });
});
