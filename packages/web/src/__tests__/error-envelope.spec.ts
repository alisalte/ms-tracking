import { describe, expect, it } from '@jest/globals';
import { errorDocument } from '../error-envelope.js';

describe('errorDocument', () => {
  it('wraps a single error in the JSON:API envelope', () => {
    const doc = errorDocument({
      code: 'NOT_FOUND',
      status: '404',
      title: 'Not Found',
      detail: 'vehicle t-1 not found',
    });
    expect(doc.errors).toHaveLength(1);
    expect(doc.errors[0]?.code).toBe('NOT_FOUND');
    expect(doc.errors[0]?.status).toBe('404');
  });

  it('preserves optional source pointer', () => {
    const doc = errorDocument({
      code: 'VALIDATION_ERROR',
      status: '422',
      title: 'Unprocessable Entity',
      source: { pointer: '/data/attributes/vin' },
    });
    expect(doc.errors[0]?.source?.pointer).toBe('/data/attributes/vin');
  });
});
