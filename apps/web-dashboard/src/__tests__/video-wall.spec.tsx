import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mockChannels } from '@/mock/video-data';
import { VideoWallPage } from '@/pages/VideoWallPage';

import { i18n } from '@/i18n';

// ── Mock canvas.captureStream (jsdom has no video capture). Returns a stub
// MediaStream so VideoTile's <video srcObject> + snapshot path don't crash.
const STUB_TRACK = { kind: 'video', stop: () => {} } as unknown as MediaStreamTrack;
const STUB_STREAM = {
  getTracks: () => [STUB_TRACK],
  addTrack: () => {},
} as unknown as MediaStream;
HTMLCanvasElement.prototype.captureStream = vi.fn(() => STUB_STREAM);

// requestAnimationFrame → instant resolve so the canvas animation draws once.
vi.stubGlobal(
  'requestAnimationFrame',
  vi.fn((cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  }),
);
vi.stubGlobal('cancelAnimationFrame', vi.fn());

// Fullscreen API is absent in jsdom — no-op so the toolbar button is clickable.
HTMLElement.prototype.requestFullscreen = vi.fn().mockResolvedValue(undefined);
Object.defineProperty(document, 'fullscreenElement', { value: null, writable: true });

// toBlob for snapshot — return a tiny blob so the download path completes.
HTMLCanvasElement.prototype.toBlob = vi.fn((cb: BlobCallback | null) => {
  cb?.(new Blob(['x'], { type: 'image/jpeg' }));
});

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } });
}

function renderWall(initialEntry = '/video') {
  const client = makeClient();
  return render(
    createElement(
      QueryClientProvider,
      { client },
      createElement(
        I18nextProvider,
        { i18n },
        createElement(
          MemoryRouter,
          { initialEntries: [initialEntry] },
          createElement(VideoWallPage),
        ),
      ),
    ),
  );
}

describe('VideoWallPage', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
  });

  /** Wait until the dock has populated with channels (query resolved). */
  async function waitForChannels() {
    // A grouped source label from the mock site cameras appears only once the
    // channels query has resolved (the dock groups by sourceLabel).
    await waitFor(() => {
      expect(screen.getByText('Main Gate')).toBeInTheDocument();
    });
  }

  /** Click a division preset button (its text may match multiple elements). */
  function clickDivision(d: number) {
    const matches = screen.getAllByText(String(d));
    // The division buttons live inside a ButtonGroup; pick the button ancestor.
    const btn = matches.map((el) => el.closest('button')).find((b) => b !== null);
    fireEvent.click(btn ?? matches[0]);
  }

  it('renders the title + 6 division buttons', async () => {
    renderWall();
    expect(await screen.findByText('Video Wall')).toBeInTheDocument();
    // The six division presets (1/4/9/16/36/64) — each renders its number.
    for (const d of [1, 4, 9, 16, 36, 64]) {
      expect(screen.getAllByText(String(d)).length).toBeGreaterThan(0);
    }
  });

  it('renders the channel dock from mock data', async () => {
    renderWall();
    await waitFor(() => {
      // The dock header (video.dock.title) — the Phase 7 "Cameras" view tab
      // carries the same label, so at least two elements match.
      expect(screen.getAllByText('Cameras').length).toBeGreaterThanOrEqual(2);
    });
  });

  it('shows the empty state before any channel is added', async () => {
    renderWall();
    expect(await screen.findByText('No cameras on the wall yet')).toBeInTheDocument();
  });

  it('auto-fills tiles when Auto-fill is clicked', async () => {
    renderWall();
    await waitForChannels();
    // Give the channels query an extra tick to populate the catalog the
    // autoFill closure reads.
    await waitFor(() => expect(screen.getByText('Auto-fill')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Auto-fill'));

    // The empty-state prompt should disappear once tiles are assigned.
    await waitFor(() => {
      expect(screen.queryByText('No cameras on the wall yet')).not.toBeInTheDocument();
    });
  });

  it('switches to the 16-division layout and fills it', async () => {
    renderWall();
    await screen.findByText('Video Wall');
    await waitForChannels();

    clickDivision(16);
    fireEvent.click(screen.getByText('Auto-fill'));

    // The empty-state prompt should disappear once tiles are assigned.
    await waitFor(() => {
      expect(screen.queryByText('No cameras on the wall yet')).not.toBeInTheDocument();
    });
  });

  it('shows the live-cap indicator for the 36-division layout', async () => {
    renderWall();
    await screen.findByText('Video Wall');
    await waitForChannels();

    clickDivision(36);
    fireEvent.click(screen.getByText('Auto-fill'));

    // The cap indicator chip appears since 36 assigned > 16 cap. Its label is
    // split across icon+text, so query the chip by its "live cap" fragment.
    await waitFor(() => {
      const chips = screen.getAllByText(/cap/);
      expect(chips.length).toBeGreaterThan(0);
    });
  });

  it('renders a snapshot control on a live tile', async () => {
    renderWall();
    await screen.findByText('Video Wall');
    await waitForChannels();

    clickDivision(1);
    fireEvent.click(screen.getByText('Auto-fill'));

    // The snapshot control (Tooltip title "Snapshot") should be present on the
    // live tile. Tooltip surfaces its title as an aria-label on the button.
    await waitFor(() => {
      expect(screen.getByLabelText('Snapshot')).toBeInTheDocument();
    });
  });

  it('uses mock channels derived from the fleet', () => {
    // Sanity: the mock catalog has channels (vehicles × 4 + sites).
    expect(mockChannels.length).toBeGreaterThan(10);
    // Includes both source types.
    expect(mockChannels.some((c) => c.sourceType === 'vehicle')).toBe(true);
    expect(mockChannels.some((c) => c.sourceType === 'site')).toBe(true);
    // Vehicle channels carry the cabin-cam flag on the driver facing.
    expect(mockChannels.some((c) => c.cabinCam && c.facing === 'driver')).toBe(true);
  });
});

// ── Phase 7 — cameras management + playback shell + view tabs ───────────────

describe('VideoWallPage — view tabs', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
  });

  /** Wait until the channels query resolved (dock/table populated). */
  async function waitForChannelsShort() {
    await waitFor(() => {
      expect(screen.getByText('Main Gate')).toBeInTheDocument();
    });
  }

  it('switches to the Cameras table and lists channels with availability', async () => {
    renderWall();
    await waitForChannelsShort();
    fireEvent.click(screen.getByRole('tab', { name: /cameras/i }));

    // Channel rows render with status + stream-availability badges.
    await waitFor(() => {
      expect(screen.getAllByText(/available/i).length).toBeGreaterThan(0);
    });
    expect(screen.getAllByRole('button', { name: /add to wall/i }).length).toBeGreaterThan(0);
  });

  it('switches to Playback and shows the honest pending-backend notice', async () => {
    renderWall();
    fireEvent.click(screen.getByRole('tab', { name: /playback/i }));

    expect(screen.getByText(/playback backend pending/i)).toBeTruthy();
    // Transport present but disabled until a window is loaded.
    expect(screen.getByTestId('video-playback-play').getAttribute('disabled')).not.toBeNull();
  });

  it('loads a playback window and drives the transport locally', async () => {
    renderWall();
    await waitForChannelsShort();
    fireEvent.click(screen.getByRole('tab', { name: /playback/i }));

    // Pick the first available channel + Load — the transport enables.
    const channelSelect = screen.getByRole('combobox');
    const firstOption = channelSelect.querySelectorAll('option')[1];
    fireEvent.change(channelSelect, { target: { value: firstOption?.value ?? '' } });
    fireEvent.click(screen.getByTestId('playback-load'));

    await waitFor(() => {
      expect(screen.getByTestId('video-playback-play').getAttribute('disabled')).toBeNull();
    });
    // Play → pause toggles playback state.
    fireEvent.click(screen.getByTestId('video-playback-play'));
    expect(screen.getByTestId('video-playback-pause')).toBeTruthy();
    fireEvent.click(screen.getByTestId('video-playback-pause'));
    expect(screen.getByTestId('video-playback-play')).toBeTruthy();
    // Stop resets the playhead (transport disabled again).
    fireEvent.click(screen.getByTestId('video-playback-stop'));
    await waitFor(() => {
      expect(screen.getByTestId('video-playback-play').getAttribute('disabled')).not.toBeNull();
    });
  });

  it('keeps the honest no-recording state in the video area (never a fake stream)', async () => {
    renderWall();
    await waitForChannelsShort();
    fireEvent.click(screen.getByRole('tab', { name: /playback/i }));

    const channelSelect = screen.getByRole('combobox');
    const firstOption = channelSelect.querySelectorAll('option')[1];
    fireEvent.change(channelSelect, { target: { value: firstOption?.value ?? '' } });
    fireEvent.click(screen.getByTestId('playback-load'));

    await waitFor(() => {
      expect(screen.getByTestId('playback-video-area').textContent).toContain(
        'No recording available',
      );
    });
  });
});

// ── MDVR real-channel regression (live-video port) ───────────────────────────

const mdvrOverride = vi.hoisted(() => ({ channels: null as null | unknown[] }));

const resourcesOverride = vi.hoisted(() => ({
  status: 'idle' as 'idle' | 'listing' | 'ready' | 'error',
  error: null as string | null,
  videos: [] as Array<{
    channel: number;
    startTime: string;
    endTime: string;
    avType: number;
    streamType: number;
    capType: number;
    fileLen: number;
    eventCode: number;
    subEventCode: number;
  }>,
  photos: [] as Array<{
    channel: number;
    startTime: string;
    endTime: string;
    avType: number;
    streamType: number;
    capType: number;
    fileLen: number;
    eventCode: number;
    subEventCode: number;
  }>,
  search: vi.fn(),
  reset: vi.fn(),
}));

const mdvrMockChannel = vi.hoisted(() => ({
  id: 'ch-mdvr-1',
  label: 'MD300 Sim · CH1',
  facing: 'site',
  sourceType: 'site',
  sourceId: 'src-1',
  sourceLabel: 'MD300 Sim · CH1',
  codec: 'H264',
  online: true,
  recordingActive: false,
  aiEnabled: false,
  cabinCam: false,
  consentGiven: true,
  protocol: 'MEITRACK_MDVR',
  deviceId: 'device-1',
  logicalChannel: 1,
  imei: '867191086416152',
}));

vi.mock('@/api/video.api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/video.api')>();
  return {
    ...actual,
    // Test-scoped override: null → the real hook (mock-gated fixture data).
    useChannels: (...args: Parameters<typeof actual.useChannels>) =>
      mdvrOverride.channels
        ? { data: mdvrOverride.channels, isLoading: false }
        : actual.useChannels(...args),
  };
});

vi.mock('@/components/video/useMdvrResources', () => ({
  useMdvrResources: () => resourcesOverride,
}));

describe('VideoWallPage with a real MEITRACK_MDVR channel (auto-fill → tile)', () => {
  afterEach(() => {
    mdvrOverride.channels = null;
    resourcesOverride.status = 'idle';
    resourcesOverride.error = null;
    resourcesOverride.videos = [];
    resourcesOverride.photos = [];
    resourcesOverride.search.mockClear();
  });

  it('assigns the MDVR channel to a wall tile', async () => {
    mdvrOverride.channels = [mdvrMockChannel];
    renderWall();
    await screen.findByText('Video Wall');
    await waitFor(() => expect(screen.getByText('Auto-fill')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Auto-fill'));
    await waitFor(() => {
      expect(screen.queryByText('No cameras on the wall yet')).not.toBeInTheDocument();
    });
    const tile = document.querySelector('[data-tile="MD300 Sim · CH1"]');
    expect(tile).not.toBeNull();
  });

  it('auto-assigns cameras from the map deep-link ?device=', async () => {
    mdvrOverride.channels = [mdvrMockChannel];
    renderWall('/video?device=device-1');
    await screen.findByText('Video Wall');
    await waitFor(() => {
      expect(document.querySelector('[data-tile="MD300 Sim · CH1"]')).not.toBeNull();
    });
  });

  it('searches the MDVR date window and plays a listed clip', async () => {
    mdvrOverride.channels = [mdvrMockChannel];
    resourcesOverride.status = 'ready';
    resourcesOverride.videos = [
      {
        channel: 1,
        startTime: '260904100000',
        endTime: '260904100500',
        avType: 3,
        streamType: 0,
        capType: 0,
        fileLen: 1_048_576,
        eventCode: 0,
        subEventCode: 0,
      },
    ];
    resourcesOverride.photos = [
      {
        channel: 1,
        startTime: '260904110000',
        endTime: '260904110001',
        avType: 4,
        streamType: 0,
        capType: 0,
        fileLen: 2048,
        eventCode: 0,
        subEventCode: 0,
      },
    ];
    renderWall('/video?view=playback');
    await screen.findByTestId('playback-load');

    const channelSelect = screen.getByRole('combobox');
    fireEvent.change(channelSelect, { target: { value: mdvrMockChannel.id } });

    expect(screen.getByTestId('playback-search')).toBeTruthy();
    expect(screen.getByTestId('playback-resource-list').textContent).toMatch(/videos/i);
    expect(screen.getByTestId('playback-clip-video-0')).toBeTruthy();
    expect(screen.getByTestId('playback-clip-photo-0')).toBeTruthy();

    fireEvent.click(screen.getByTestId('playback-search'));
    expect(resourcesOverride.search).toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('playback-clip-video-0'));
    await waitFor(() => {
      expect(screen.getByTestId('video-playback-play').getAttribute('disabled')).toBeNull();
    });
  });
});

// ── MDVR real-channel regression (live-video port) ───────────────────────────

describe('WallGrid with a real MEITRACK_MDVR channel', () => {
  it('renders the assigned channel tile (data-tile) even with protocol/device fields', () => {
    const mdvrChannel = {
      ...mockChannels[0],
      id: 'ch-mdvr-1',
      label: 'MD300 Sim · CH1',
      sourceLabel: 'MD300 Sim · CH1',
      online: true,
      consentGiven: true,
      protocol: 'MEITRACK_MDVR',
      deviceId: 'device-1',
      logicalChannel: 1,
      imei: '867191086416152',
    };
    const tiles = [
      { slot: 0, channelId: 'ch-mdvr-1', pinned: false },
      { slot: 1, channelId: null, pinned: false },
      { slot: 2, channelId: null, pinned: false },
      { slot: 3, channelId: null, pinned: false },
    ];
    const { WallGrid } = WallGridModule;
    const grid = render(
      createElement(
        QueryClientProvider,
        { client: makeClient() },
        createElement(
          I18nextProvider,
          { i18n },
          createElement(WallGrid, {
            division: 4 as never,
            tiles: tiles as never,
            channels: [mdvrChannel] as never,
            spotlightSlot: null,
            rotationOn: false,
            maxLive: 16,
            onTogglePin: () => {},
            onRemove: () => {},
          }),
        ),
      ),
    );
    const labeled = grid.container.querySelector('[data-tile="MD300 Sim · CH1"]');
    expect(labeled).not.toBeNull();
  });
});

import * as WallGridModule from '@/components/video/WallGrid';

// ── Wire-shape regression: media-service rows are camelCase ──────────────────

describe('mapMediaChannel wire shape', () => {
  it('reads camelCase fields (channelId/vehicleId/logicalChannel)', async () => {
    const { mapMediaChannelForTest } = await import('@/api/video.api');
    const wire = {
      channelId: 'wire-1',
      vehicleId: null,
      siteId: null,
      deviceId: 'dev-1',
      label: 'MD300 CH1',
      logicalChannel: 2,
      protocol: 'MEITRACK_MDVR',
      codec: 'H264',
      endpoint: '867191086416152',
      status: 'REGISTERED',
    };
    const ch = mapMediaChannelForTest(wire as never);
    expect(ch.id).toBe('wire-1');
    expect(ch.logicalChannel).toBe(2);
    expect(ch.imei).toBe('867191086416152');
    expect(ch.online).toBe(true);
    expect(ch.protocol).toBe('MEITRACK_MDVR');
    expect(ch.sourceId).toBe('dev-1');
    expect(ch.sourceLabel).toBe('MDVR 867191086416152');
  });

  it('builds AB2 RTMP and HLS URLs from the IMEI', async () => {
    const { mdvrRtmpUploadUrl, mdvrHlsUrl } = await import('@/api/video.api');
    expect(mdvrRtmpUploadUrl('867191086416152')).toMatch(/^rtmp:\/\/[^/]+:1935\/live\/md300\/1$/);
    expect(mdvrHlsUrl('867191086416152')).toContain('/media-hls/live/md300/1/index.m3u8');
    expect(mdvrRtmpUploadUrl('867191086416152', 2)).toMatch(/\/live\/md300\/2$/);
    expect(mdvrHlsUrl('867191086416152', 2)).toContain('/media-hls/live/md300/2/index.m3u8');
  });

  it('builds a sibling playback RTMP/HLS path so AB4 does not clobber live', async () => {
    const { mdvrPlaybackRtmpUrl, mdvrPlaybackHlsUrl, toMdvrBcdTime } = await import(
      '@/api/video.api'
    );
    expect(mdvrPlaybackRtmpUrl('867191086416152', 2)).toMatch(/\/live\/md300\/2\/pb$/);
    expect(mdvrPlaybackHlsUrl('867191086416152', 1)).toContain(
      '/media-hls/live/md300/1/index.m3u8',
    );
    expect(toMdvrBcdTime(Date.UTC(2026, 8, 4, 11, 30, 5))).toMatch(/^\d{12}$/);
  });

  it('round-trips MDVR BCD timestamps and parses an AB8 ack JSON', async () => {
    const { fromMdvrBcdTime, toMdvrBcdTime, parseMdvrResourceAck, mdvrResourceKind } = await import(
      '@/api/video.api'
    );
    const ms = new Date(2026, 8, 4, 11, 30, 5).getTime();
    expect(fromMdvrBcdTime(toMdvrBcdTime(ms))).toBe(ms);
    const rows = parseMdvrResourceAck(
      JSON.stringify({
        resources: [
          {
            channel: 1,
            startTime: '260904100000',
            endTime: '260904100500',
            avType: 3,
            streamType: 0,
            capType: 0,
            fileLen: 1024,
            eventCode: 0,
            subEventCode: 0,
          },
          {
            channel: 1,
            startTime: '260904110000',
            endTime: '260904110001',
            avType: 4,
            fileLen: 2048,
          },
        ],
      }),
    );
    expect(rows).toHaveLength(2);
    expect(mdvrResourceKind(rows[0]?.avType ?? 0)).toBe('video');
    expect(mdvrResourceKind(rows[1]?.avType ?? 0)).toBe('photo');
    expect(parseMdvrResourceAck('not-json')).toEqual([]);
  });
});
