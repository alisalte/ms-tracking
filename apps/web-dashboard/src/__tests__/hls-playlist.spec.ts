import { describe, expect, it } from 'vitest';

import { mediaPlaylistIsReady, parseMediaSegments } from '@/lib/hls-playlist';

const GAP_THEN_REAL = `#EXTM3U
#EXT-X-VERSION:9
#EXTINF:1.00000,
#EXT-X-GAP
gap.mp4
#EXTINF:1.00000,
seg1.mp4
`;

const ONLY_GAPS = `#EXTM3U
#EXT-X-VERSION:9
#EXTINF:1.00000,
#EXT-X-GAP
gap.mp4
`;

const GAP_FREE = `#EXTM3U
#EXTINF:1.00000,
seg0.mp4
`;

const MASTER = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=2000000
index.m3u8
`;

describe('mediaPlaylistIsReady', () => {
  it('treats a master playlist as not yet playable', () => {
    expect(parseMediaSegments(MASTER)).toBeNull();
    expect(mediaPlaylistIsReady(MASTER, false)).toBe(false);
  });

  it('attaches live as soon as the newest segment is real', () => {
    expect(mediaPlaylistIsReady(GAP_THEN_REAL, false)).toBe(true);
    expect(mediaPlaylistIsReady(ONLY_GAPS, false)).toBe(false);
  });

  it('keeps playback waiting for a fully gap-free window', () => {
    expect(mediaPlaylistIsReady(GAP_THEN_REAL, true)).toBe(false);
    expect(mediaPlaylistIsReady(GAP_FREE, true)).toBe(true);
  });
});
