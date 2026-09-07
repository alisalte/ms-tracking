/**
 * HLSLivePlayer — MD300/MDVR live path (AB2 → MediaMTX → HLS).
 *
 * MediaMTX returns 404 until the device is actually publishing RTMP. We poll
 * the playlist silently and only then attach hls.js, so the console is not
 * flooded with 404s while waiting for AB2 dialback.
 */
import Hls from 'hls.js';
import { forwardRef, useEffect, useRef } from 'react';

import { mediaPlaylistIsReady } from '@/lib/hls-playlist';

interface HLSLivePlayerProps {
  hlsUrl: string | null;
  muted?: boolean;
  /** Fires once the playlist is parsed / native HLS has a source. */
  onReady?: () => void;
  objectFit?: 'cover' | 'contain';
  /** Live edge snap. Recorded AB4 push should stay false so leftover live segments are not skipped-to. */
  lowLatencyMode?: boolean;
}

/** Fast enough to catch the first real segment without waiting a full GOP. */
const POLL_MS = 500;
/** Back off empty/error polls so MediaMTX is not asked to create/destroy an HLS muxer 2×/s. */
const POLL_EMPTY_MAX_MS = 3000;

function playlistWaitReason(status: number, requireGapFree: boolean): string {
  if (status === 200) {
    return requireGapFree
      ? 'playlist is up but still has EXT-X-GAP placeholders; waiting for a gap-free window.'
      : 'playlist is up but the newest segment is still a GAP placeholder; waiting for the first real segment.';
  }
  if (status === 204) {
    return 'MediaMTX has no publisher yet (device has not pushed RTMP to :1935, or ffmpeg transcode is still starting).';
  }
  if (status === 500 || status === 502 || status === 503) {
    return 'HLS muxer not ready (ffmpeg transcode still starting).';
  }
  return 'unexpected status.';
}

/** hls.js media-error recoveries before we stop (avoids an endless fatal loop). */
const MAX_MEDIA_RECOVERIES = 2;

/** Console tag so `[MDVR]` is easy to filter/search in devtools. */
function mdvrLog(...args: unknown[]): void {
  // eslint-disable-next-line no-console
  console.log('[MDVR]', ...args);
}

/**
 * A 200 playlist is not the same as a playable one: MediaMTX pads the window
 * with `#EXT-X-GAP` placeholders. Live attaches once the *newest* segment is
 * real (hls.js sits on the live edge). Playback still waits for a gap-free
 * window so a start-from-head attach cannot stall on a leading placeholder.
 *
 * Waiting for every GAP to age out of a 7×~10s window is what made the wall
 * look "broken" after a pull — the stream was up, the player just would not
 * start for minutes.
 */
async function hasPlayableSegment(
  url: string,
  signal: AbortSignal,
  requireGapFree: boolean,
  depth = 0,
): Promise<{ ready: boolean; status: number }> {
  const res = await fetch(url, { method: 'GET', cache: 'no-store', signal });
  if (res.status !== 200) return { ready: false, status: res.status };
  const text = await res.text();
  if (mediaPlaylistIsReady(text, requireGapFree)) return { ready: true, status: 200 };
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.some((line) => line.startsWith('#EXTINF'))) {
    return { ready: false, status: 200 };
  }
  const variant = lines.find((line) => !line.startsWith('#'));
  if (!variant || depth > 2) return { ready: false, status: 200 };
  return hasPlayableSegment(new URL(variant, url).toString(), signal, requireGapFree, depth + 1);
}

async function waitForPlaylist(
  url: string,
  signal: AbortSignal,
  requireGapFree: boolean,
): Promise<boolean> {
  let attempt = 0;
  while (!signal.aborted) {
    attempt++;
    try {
      const res = await hasPlayableSegment(url, signal, requireGapFree);
      if (res.ready) {
        mdvrLog(`playlist ready after ${attempt} poll(s): ${url}`);
        return true;
      }
      if (attempt === 1 || attempt % 5 === 0) {
        mdvrLog(
          `waiting for playlist (attempt ${attempt}, HTTP ${res.status}): ${url} — ${playlistWaitReason(res.status, requireGapFree)}`,
        );
      }
      const delay =
        res.status === 200 ? POLL_MS : Math.min(POLL_EMPTY_MAX_MS, POLL_MS + attempt * 150);
      await new Promise((r) => setTimeout(r, delay));
      continue;
    } catch (err) {
      if (signal.aborted) return false;
      if (attempt === 1 || attempt % 5 === 0) {
        mdvrLog(`playlist fetch error (attempt ${attempt}): ${url}`, err);
      }
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  mdvrLog(`playlist wait aborted: ${url}`);
  return false;
}

export const HLSLivePlayer = forwardRef<HTMLVideoElement, HLSLivePlayerProps>(
  function HLSLivePlayer(
    { hlsUrl, muted = true, onReady, objectFit = 'cover', lowLatencyMode = true },
    ref,
  ) {
    const innerRef = useRef<HTMLVideoElement | null>(null);
    const onReadyRef = useRef(onReady);
    onReadyRef.current = onReady;

    useEffect(() => {
      const video = innerRef.current;
      if (!video || !hlsUrl) return;
      const ac = new AbortController();
      let destroyed = false;
      let hls: Hls | null = null;
      let retryTimer: ReturnType<typeof setTimeout> | null = null;

      const attachNative = () => {
        mdvrLog(`attaching native HLS (Safari) to ${hlsUrl}`);
        video.src = hlsUrl;
        video.addEventListener(
          'loadedmetadata',
          () => {
            mdvrLog(`native HLS loadedmetadata: ${hlsUrl}`);
            if (!destroyed) onReadyRef.current?.();
          },
          { once: true },
        );
        video.addEventListener('error', () => {
          mdvrLog(`native <video> error for ${hlsUrl}:`, video.error);
        });
        void video.play()?.catch?.((err) => mdvrLog('native video.play() rejected:', err));
      };

      let mediaRecoveries = 0;
      const requireGapFree = !lowLatencyMode;

      const attachHls = () => {
        mdvrLog(`attaching hls.js to ${hlsUrl}`);
        mediaRecoveries = 0;
        hls?.destroy();
        hls = new Hls({
          liveSyncDurationCount: lowLatencyMode ? 1 : 3,
          liveMaxLatencyDurationCount: lowLatencyMode ? 4 : 6,
          enableWorker: true,
          lowLatencyMode,
        });
        hls.loadSource(hlsUrl);
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          if (destroyed) return;
          mdvrLog(`hls.js MANIFEST_PARSED — starting playback: ${hlsUrl}`);
          void video.play()?.catch?.((err) => mdvrLog('hls.js video.play() rejected:', err));
          onReadyRef.current?.();
        });
        hls.on(Hls.Events.ERROR, (_event, data) => {
          mdvrLog(
            `hls.js ${data.fatal ? 'FATAL' : 'non-fatal'} error: type=${data.type} details=${data.details}`,
            data,
          );
          if (destroyed || !data.fatal) return;
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            mdvrLog(`hls.js network error — will re-poll playlist and retry: ${hlsUrl}`);
            retryTimer = setTimeout(() => {
              if (!destroyed) {
                void waitForPlaylist(hlsUrl, ac.signal, requireGapFree).then((ok) => {
                  if (ok && !destroyed) attachHls();
                });
              }
            }, POLL_MS);
          } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
            // Escalate the way hls.js documents it, and STOP after that: a bad
            // audio track (`mediaSourceRequiresReset` on the audio
            // SourceBuffer) otherwise loops fatal → recover → fatal forever and
            // takes the perfectly good video down with it.
            mediaRecoveries += 1;
            if (mediaRecoveries > MAX_MEDIA_RECOVERIES) {
              mdvrLog(
                `hls.js media error persisted after ${MAX_MEDIA_RECOVERIES} recovery attempts (${data.details}, buffer=${data.sourceBufferName ?? 'n/a'}) — giving up instead of looping.`,
              );
              return;
            }
            if (mediaRecoveries > 1) {
              mdvrLog(`hls.js media error — swapAudioCodec() + recover (#${mediaRecoveries})`);
              hls?.swapAudioCodec();
            } else {
              mdvrLog(`hls.js media error — attempting recoverMediaError(): ${hlsUrl}`);
            }
            hls?.recoverMediaError();
          }
        });
      };

      mdvrLog(`waiting for playlist to become available: ${hlsUrl}`);
      void waitForPlaylist(hlsUrl, ac.signal, requireGapFree).then((ok) => {
        if (!ok || destroyed) return;
        if (video.canPlayType('application/vnd.apple.mpegurl')) attachNative();
        else if (Hls.isSupported()) attachHls();
        else mdvrLog('neither native HLS nor hls.js is supported in this browser.');
      });

      return () => {
        destroyed = true;
        ac.abort();
        if (retryTimer) clearTimeout(retryTimer);
        hls?.destroy();
        hls = null;
        video.removeAttribute('src');
        video.load();
      };
    }, [hlsUrl, lowLatencyMode]);

    return (
      <video
        ref={(el) => {
          innerRef.current = el;
          if (typeof ref === 'function') ref(el);
          else if (ref) ref.current = el;
        }}
        muted={muted}
        playsInline
        autoPlay
        style={{ width: '100%', height: '100%', objectFit, display: 'block' }}
      />
    );
  },
);
