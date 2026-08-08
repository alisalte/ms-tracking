import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
      // The dock header.
      expect(screen.getByText('Cameras')).toBeInTheDocument();
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
