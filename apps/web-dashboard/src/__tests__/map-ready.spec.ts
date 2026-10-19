import { describe, expect, it } from 'vitest';

import { runWhenStyleReady } from '@/lib/map-ready';

function fakeMap(styleLoaded = false) {
  let ready = styleLoaded;
  const listeners = new Map<string, Set<(event?: { type?: string }) => void>>();
  return {
    loaded: () => false,
    isStyleLoaded: () => ready,
    on(event: string, fn: (event?: { type?: string }) => void) {
      let set = listeners.get(event);
      if (!set) {
        set = new Set();
        listeners.set(event, set);
      }
      set.add(fn);
    },
    off(event: string, fn: (event?: { type?: string }) => void) {
      listeners.get(event)?.delete(fn);
    },
    emit(event: string) {
      for (const fn of [...(listeners.get(event) ?? [])]) fn({ type: event });
    },
    markStyleLoaded() {
      ready = true;
    },
  };
}

describe('runWhenStyleReady', () => {
  it('runs immediately when the style is already loaded', () => {
    const map = fakeMap(true);
    let ran = 0;
    runWhenStyleReady(map as never, () => {
      ran += 1;
    });
    expect(ran).toBe(1);
  });

  it('keeps listening when the first styledata arrives too early', () => {
    const map = fakeMap(false);
    let ran = 0;
    runWhenStyleReady(map as never, () => {
      ran += 1;
    });
    map.emit('styledata');
    expect(ran).toBe(0);
    map.markStyleLoaded();
    map.emit('styledata');
    expect(ran).toBe(1);
    map.emit('styledata');
    expect(ran).toBe(1);
  });

  it('accepts the load event after a premature styledata', () => {
    const map = fakeMap(false);
    let ran = 0;
    runWhenStyleReady(map as never, () => {
      ran += 1;
    });
    map.emit('styledata');
    map.emit('load');
    expect(ran).toBe(1);
  });
});
