import { beforeEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_MDVR_LIVE_RESOLUTION,
  MDVR_LIVE_RESOLUTION_EVENT,
  loadMdvrLiveResolution,
  mdvrStreamTypeForResolution,
  saveMdvrLiveResolution,
} from '@/lib/mdvr-live-resolution';

describe('mdvr live resolution', () => {
  beforeEach(() => localStorage.clear());

  it('defaults to the sub stream so cameras open on the lighter push', () => {
    expect(DEFAULT_MDVR_LIVE_RESOLUTION).toBe('low');
    expect(loadMdvrLiveResolution()).toBe('low');
    expect(mdvrStreamTypeForResolution('low')).toBe('1');
    expect(mdvrStreamTypeForResolution('high')).toBe('0');
  });

  it('persists a change and notifies open tiles once', () => {
    let fired = 0;
    const onChange = () => {
      fired += 1;
    };
    window.addEventListener(MDVR_LIVE_RESOLUTION_EVENT, onChange);
    saveMdvrLiveResolution('high');
    saveMdvrLiveResolution('high');
    expect(loadMdvrLiveResolution()).toBe('high');
    expect(fired).toBe(1);
    window.removeEventListener(MDVR_LIVE_RESOLUTION_EVENT, onChange);
  });
});
