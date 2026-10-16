import { afterEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_MAP_CAMERA,
  MAP_CAMERA_STORAGE_KEY,
  loadPersistedMapCamera,
  persistMapCamera,
} from '@/lib/map-camera';

describe('map-camera', () => {
  afterEach(() => {
    localStorage.removeItem(MAP_CAMERA_STORAGE_KEY);
  });

  it('defaults to the Tehran bootstrap view', () => {
    expect(loadPersistedMapCamera()).toEqual(DEFAULT_MAP_CAMERA);
  });

  it('persists and restores the operator zoom/center', () => {
    persistMapCamera({ lng: 50.66, lat: 33.93, zoom: 15.4 });
    expect(loadPersistedMapCamera()).toEqual({ lng: 50.66, lat: 33.93, zoom: 15.4 });
  });

  it('ignores corrupt storage values', () => {
    localStorage.setItem(MAP_CAMERA_STORAGE_KEY, '{not-json');
    expect(loadPersistedMapCamera()).toEqual(DEFAULT_MAP_CAMERA);
    localStorage.setItem(MAP_CAMERA_STORAGE_KEY, JSON.stringify({ lng: 1, lat: 2, zoom: 99 }));
    expect(loadPersistedMapCamera()).toEqual(DEFAULT_MAP_CAMERA);
  });
});
