import { beforeEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_MDVR_LIVE_RESOLUTION,
  MDVR_LIVE_RESOLUTION_EVENT,
  MDVR_SUBSTREAM_FALLBACK_MS,
  loadMdvrLiveResolution,
  mdvrStreamTypeForResolution,
  mdvrSubStreamFallback,
  saveMdvrLiveResolution,
} from '@/lib/mdvr-live-resolution';

describe('mdvr live resolution', () => {
  beforeEach(() => localStorage.clear());

  it('defaults to the main stream — the push md300 live.js and the last working wall sent', () => {
    expect(DEFAULT_MDVR_LIVE_RESOLUTION).toBe('high');
    expect(loadMdvrLiveResolution()).toBe('high');
    expect(mdvrStreamTypeForResolution('low')).toBe('1');
    expect(mdvrStreamTypeForResolution('high')).toBe('0');
  });

  it('persists a change and notifies open tiles once', () => {
    let fired = 0;
    const onChange = () => {
      fired += 1;
    };
    window.addEventListener(MDVR_LIVE_RESOLUTION_EVENT, onChange);
    saveMdvrLiveResolution('low');
    saveMdvrLiveResolution('low');
    expect(loadMdvrLiveResolution()).toBe('low');
    expect(fired).toBe(1);
    window.removeEventListener(MDVR_LIVE_RESOLUTION_EVENT, onChange);
  });

  it('asks for the main stream when the sub stream never publishes', () => {
    expect(mdvrSubStreamFallback('1', false, MDVR_SUBSTREAM_FALLBACK_MS - 1)).toBeNull();
    expect(mdvrSubStreamFallback('1', true, MDVR_SUBSTREAM_FALLBACK_MS)).toBeNull();
    expect(mdvrSubStreamFallback('0', false, MDVR_SUBSTREAM_FALLBACK_MS)).toBeNull();
    expect(mdvrSubStreamFallback('1', false, MDVR_SUBSTREAM_FALLBACK_MS)).toBe('0');
  });
});
