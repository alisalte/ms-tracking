import { describe, expect, it } from '@jest/globals';
import { generateTraceparent, parseTraceparent } from '../traceparent.js';

describe('traceparent', () => {
  it('generates a spec-compliant traceparent', () => {
    const tp = generateTraceparent();
    expect(tp).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/);
  });

  it('parses a valid traceparent', () => {
    const tp = '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01';
    const parsed = parseTraceparent(tp);
    expect(parsed).not.toBeNull();
    expect(parsed?.traceId).toBe('0af7651916cd43dd8448eb211c80319c');
    expect(parsed?.spanId).toBe('b7ad6b7169203331');
  });

  it('rejects malformed traceparent', () => {
    expect(parseTraceparent('garbage')).toBeNull();
    expect(parseTraceparent('00-short-short-01')).toBeNull();
  });
});
