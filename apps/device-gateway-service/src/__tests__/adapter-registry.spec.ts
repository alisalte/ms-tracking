import { beforeEach, describe, expect, it } from '@jest/globals';
import { ProtocolError } from '../domain/errors.js';
import {
  AdapterRegistry,
  type ProtocolAdapter,
  type ProtocolMeta,
} from '../infrastructure/protocol/index.js';

function fakeAdapter(id: string, magic: number, confidence = 0.9): ProtocolAdapter {
  const meta: ProtocolMeta = {
    name: id,
    defaultPort: 5000,
    transport: 'both',
    framingType: 'test',
    authStrategy: 'test',
    deviceModels: ['x'],
  };
  return {
    id,
    meta,
    detect: (peek) => (peek.length >= 1 && peek[0] === magic ? { confidence } : { confidence: 0 }),
    frame: () => {
      throw new Error('not used');
    },
    decode: () => [],
    encode: () => Buffer.alloc(0),
  };
}

describe('AdapterRegistry (PAL)', () => {
  let reg: AdapterRegistry;
  beforeEach(() => {
    reg = new AdapterRegistry();
  });

  it('registers and retrieves enabled adapters', () => {
    const a = fakeAdapter('a', 0xaa);
    reg.register(a);
    expect(reg.get('a')).toBe(a);
    expect(reg.enabled()).toHaveLength(1);
  });

  it('get returns null for disabled adapters', () => {
    const a = fakeAdapter('a', 0xaa);
    reg.register(a);
    reg.setEnabled('a', false);
    expect(reg.get('a')).toBeNull();
    expect(reg.getAny('a')).toBe(a);
    expect(reg.enabled()).toHaveLength(0);
  });

  it('setEnabled returns false for unknown id', () => {
    expect(reg.setEnabled('nope', true)).toBe(false);
  });

  it('detect picks the highest-confidence enabled adapter above threshold', () => {
    reg.register(fakeAdapter('low', 0xaa, 0.3));
    reg.register(fakeAdapter('high', 0xaa, 0.95));
    reg.register(fakeAdapter('other', 0xbb, 0.6));
    const match = reg.detect(Buffer.from([0xaa]));
    expect(match?.id).toBe('high');
  });

  it('detect returns null when no adapter reaches the threshold', () => {
    reg.register(fakeAdapter('low', 0xaa, 0.2));
    expect(reg.detect(Buffer.from([0xaa]))).toBeNull();
  });

  it('detect ignores disabled adapters', () => {
    reg.register(fakeAdapter('a', 0xaa, 0.95));
    reg.setEnabled('a', false);
    expect(reg.detect(Buffer.from([0xaa]))).toBeNull();
  });

  it('require throws ProtocolError for missing/disabled adapter', () => {
    expect(() => reg.require('missing')).toThrow(ProtocolError);
  });

  it('hot-reload replaces an adapter implementation, preserving enablement', () => {
    const v1 = fakeAdapter('a', 0xaa);
    const v2 = fakeAdapter('a', 0xaa);
    reg.register(v1);
    reg.setEnabled('a', false);
    reg.register(v2); // hot reload
    expect(reg.getAny('a')).toBe(v2);
    expect(reg.list()[0]?.enabled).toBe(false); // preserved
  });

  it('unregister removes an adapter', () => {
    reg.register(fakeAdapter('a', 0xaa));
    expect(reg.unregister('a')).toBe(true);
    expect(reg.getAny('a')).toBeNull();
    expect(reg.unregister('a')).toBe(false);
  });

  it('list reports dynamic flag', () => {
    reg.register(fakeAdapter('builtin', 0xaa), false);
    reg.register(fakeAdapter('plugin', 0xbb), true);
    const ids = Object.fromEntries(reg.list().map((s) => [s.id, s.dynamic]));
    expect(ids).toEqual({ builtin: false, plugin: true });
  });
});
