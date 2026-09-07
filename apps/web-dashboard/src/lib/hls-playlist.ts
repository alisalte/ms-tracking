/**
 * MediaMTX HLS readiness — the muxer can serve a 200 playlist padded with
 * `#EXT-X-GAP` / `gap.mp4` placeholders before any real segment exists.
 *
 * Live tiles only need the *newest* segment to be real (hls.js starts at the
 * live edge). Playback waits for a fully gap-free window so a start-from-head
 * attach does not stall on a leading placeholder.
 */

export interface MediaSegment {
  uri: string;
  gap: boolean;
}

export function parseMediaSegments(playlistText: string): MediaSegment[] | null {
  const lines = playlistText
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.some((line) => line.startsWith('#EXTINF'))) return null;
  const segments: MediaSegment[] = [];
  let nextGap = false;
  for (const line of lines) {
    if (line.startsWith('#EXT-X-GAP')) {
      nextGap = true;
      continue;
    }
    if (line.startsWith('#')) continue;
    segments.push({ uri: line, gap: nextGap || line.startsWith('gap.') });
    nextGap = false;
  }
  return segments;
}

export function mediaPlaylistIsReady(playlistText: string, requireGapFree: boolean): boolean {
  const segments = parseMediaSegments(playlistText);
  if (!segments || segments.length === 0) return false;
  if (requireGapFree) return segments.every((segment) => !segment.gap);
  const last = segments[segments.length - 1];
  return last !== undefined && !last.gap;
}
