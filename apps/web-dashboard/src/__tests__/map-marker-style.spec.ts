import { afterEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_MAP_MARKER_STYLE,
  MAP_MARKER_STYLE_COOKIE_KEY,
  MAP_MARKER_STYLE_STORAGE_KEY,
  loadPersistedMapMarkerStyle,
  persistMapMarkerStyle,
} from '@/lib/map-marker-style';
import { clearPrefCookie, readPrefCookie } from '@/lib/pref-cookie';

describe('map marker style persistence', () => {
  afterEach(() => {
    localStorage.removeItem(MAP_MARKER_STYLE_STORAGE_KEY);
    clearPrefCookie(MAP_MARKER_STYLE_COOKIE_KEY);
  });

  it('defaults to the vehicle body', () => {
    expect(loadPersistedMapMarkerStyle()).toBe(DEFAULT_MAP_MARKER_STYLE);
  });

  it('saves the choice in a cookie so the next visit keeps it', () => {
    persistMapMarkerStyle('navigation');
    expect(readPrefCookie(MAP_MARKER_STYLE_COOKIE_KEY)).toBe('navigation');
    expect(localStorage.getItem(MAP_MARKER_STYLE_STORAGE_KEY)).toBe('navigation');
    expect(loadPersistedMapMarkerStyle()).toBe('navigation');
  });

  it('restores from the cookie even when localStorage is empty', () => {
    persistMapMarkerStyle('navigation');
    localStorage.removeItem(MAP_MARKER_STYLE_STORAGE_KEY);
    expect(loadPersistedMapMarkerStyle()).toBe('navigation');
  });

  it('migrates a legacy localStorage value into the cookie', () => {
    localStorage.setItem(MAP_MARKER_STYLE_STORAGE_KEY, 'navigation');
    expect(loadPersistedMapMarkerStyle()).toBe('navigation');
    expect(readPrefCookie(MAP_MARKER_STYLE_COOKIE_KEY)).toBe('navigation');
  });
});
