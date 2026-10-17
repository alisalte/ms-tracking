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
 * Sub stream by default. Main-stream pushes are what made cameras sit on
 * "waiting" for so long; the lighter stream starts sooner.
 */
export const DEFAULT_MDVR_LIVE_RESOLUTION: MdvrLiveResolution = 'low';

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
