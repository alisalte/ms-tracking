import { render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hlsInstances: Array<{ loadSource: ReturnType<typeof vi.fn> }> = [];

vi.mock('hls.js', () => {
  class FakeHls {
    static isSupported = vi.fn(() => true);
    static Events = { MANIFEST_PARSED: 'manifestParsed', ERROR: 'error' };
    static ErrorTypes = { NETWORK_ERROR: 'networkError', MEDIA_ERROR: 'mediaError' };
    loadSource = vi.fn();
    attachMedia = vi.fn();
    on = vi.fn();
    destroy = vi.fn();
    constructor() {
      hlsInstances.push(this);
    }
  }
  return { default: FakeHls };
});

import { HLSLivePlayer } from '@/components/video/HLSLivePlayer';

const PLAYLIST = '#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXTINF:2.0,\nseg1.mp4\n';
const URL = 'http://host/media-hls/live/md300/index.m3u8';

describe('HLSLivePlayer', () => {
  beforeEach(() => {
    hlsInstances.length = 0;
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(PLAYLIST, { status: 200 }) as Response,
    );
  });
  afterEach(() => vi.restoreAllMocks());

  it('uses hls.js even when the browser reports native HLS (Chrome 155)', async () => {
    // Chrome's native HLS cannot parse MediaMTX's low-latency playlist.
    vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('maybe');
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
    const { container } = render(<HLSLivePlayer hlsUrl={URL} />);
    await waitFor(() => expect(hlsInstances).toHaveLength(1));
    expect(hlsInstances[0]?.loadSource).toHaveBeenCalledWith(URL);
    expect(container.querySelector('video')?.getAttribute('src')).toBeNull();
  });
});
