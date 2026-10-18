/**
 * Live MDVR picture size.
 *
 * The device only has two pushes: the main stream (AB2 streamType 0, large
 * and slow to start on cellular) and the sub stream (streamType 1, smaller
 * and quicker to open). Operators pick which one the wall requests.
 */
export type MdvrLiveResolution = 'high' | 'low';

const STORAGE_KEY = 'fv:mdvr-live-resolution';

/** Fired after the saved resolution changes so open tiles re-request AB2. */
export const MDVR_LIVE_RESOLUTION_EVENT = 'fv:mdvr-live-resolution';

/**
 * Main stream by default. AB2 has no resolution field — this preference is
 * only the stream-type byte (0 major, 1 minor). md300 `live.js` and the last
 * working wall both sent 0. Minor (1) is acknowledged by units whose sub
 * stream is off, and then no RTMP publisher ever appears.
 */
export const DEFAULT_MDVR_LIVE_RESOLUTION: MdvrLiveResolution = 'high';

export function isMdvrLiveResolution(value: unknown): value is MdvrLiveResolution {
  return value === 'high' || value === 'low';
}

export function loadMdvrLiveResolution(): MdvrLiveResolution {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (isMdvrLiveResolution(raw)) return raw;
  } catch {
    /* private mode / unavailable storage */
  }
  return DEFAULT_MDVR_LIVE_RESOLUTION;
}

export function saveMdvrLiveResolution(value: MdvrLiveResolution): void {
  const previous = loadMdvrLiveResolution();
  try {
    localStorage.setItem(STORAGE_KEY, value);
  } catch {
    /* ignore — the in-memory listeners still apply for this page */
  }
  if (previous === value) return;
  window.dispatchEvent(new Event(MDVR_LIVE_RESOLUTION_EVENT));
}

/** AB2/AB3 stream byte: 0 main, 1 sub. */
export function mdvrStreamTypeForResolution(resolution: MdvrLiveResolution): '0' | '1' {
  return resolution === 'high' ? '0' : '1';
}

/**
 * How long to wait for the sub-stream RTMP publisher before asking for the
 * main stream. Some units have the sub stream disabled; they ACK AB2 and
 * then never push, so the wall stays on HTTP 204 until this fallback.
 */
export const MDVR_SUBSTREAM_FALLBACK_MS = 25_000;

/**
 * `null` means keep waiting. `'0'` means the sub stream did not publish and
 * the wall should send one main-stream AB2.
 */
export function mdvrSubStreamFallback(
  requested: '0' | '1',
  ingestLive: boolean,
  elapsedMs: number,
): '0' | null {
  if (requested !== '1' || ingestLive) return null;
  if (elapsedMs < MDVR_SUBSTREAM_FALLBACK_MS) return null;
  return '0';
}
