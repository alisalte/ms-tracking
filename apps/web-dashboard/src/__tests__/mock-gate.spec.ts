import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { shouldUseMock } from '@/lib/mock-gate';

/**
 * Sprint 3: the mock-gate default flipped from ON → OFF (real APIs first).
 * `?useMock=true` / `VITE_USE_MOCK=true` re-enables mocks for demos.
 */
describe('mock-gate default is real-first (OFF)', () => {
  beforeEach(() => {
    // The global test setup enables mock mode; clear it to test the default.
    window.localStorage.removeItem('fleetvision_use_mock');
    window.history.replaceState({}, '', window.location.pathname);
  });
  afterEach(() => {
    window.localStorage.removeItem('fleetvision_use_mock');
    window.history.replaceState({}, '', window.location.pathname);
  });

  it('defaults to false (real APIs) when no override is set', () => {
    expect(shouldUseMock()).toBe(false);
  });

  it('returns true when localStorage flag is set to true', () => {
    window.localStorage.setItem('fleetvision_use_mock', 'true');
    expect(shouldUseMock()).toBe(true);
  });

  it('returns false when localStorage flag is set to false', () => {
    window.localStorage.setItem('fleetvision_use_mock', 'false');
    expect(shouldUseMock()).toBe(false);
  });

  it('persists ?useMock=true to localStorage', () => {
    window.history.replaceState({}, '', '?useMock=true');
    shouldUseMock(); // triggers the readRuntimeFlag side-effect
    expect(window.localStorage.getItem('fleetvision_use_mock')).toBe('true');
    expect(shouldUseMock()).toBe(true);
  });
});
