/**
 * HLSLivePlayer — MD300/MDVR live path (AB2 → MediaMTX → HLS).
 *
 * MediaMTX returns 404 until the device is actually publishing RTMP. We poll
 * the playlist silently and only then attach hls.js, so the console is not
 * flooded with 404s while waiting for AB2 dialback.
 */
import Hls from 'hls.js';
import { forwardRef, useEffect, useRef } from 'react';

interface HLSLivePlayerProps {
  hlsUrl: string | null;
  muted?: boolean;
  /** Fires once the playlist is parsed / native HLS has a source. */
  onReady?: () => void;
  objectFit?: 'cover' | 'contain';
  /** Live edge snap. Recorded AB4 push should stay false so leftover live segments are not skipped-to. */
  lowLatencyMode?: boolean;
}

const POLL_MS = 2000;

/** hls.js media-error recoveries before we stop (avoids an endless fatal loop). */
const MAX_MEDIA_RECOVERIES = 2;

/** Console tag so `[MDVR]` is easy to filter/search in devtools. */
function mdvrLog(...args: unknown[]): void {
  // eslint-disable-next-line no-console
  console.log('[MDVR]', ...args);
}

/**
 * A 200 playlist is not the same as a playable one: MediaMTX serves the muxer
 * as soon as it exists and pads the window with `#EXT-X-GAP` / `gap.mp4`
 * placeholders until the source settles. hls.js starts at the head of the
 * window, so a single leading gap is enough to make it emit `fragGap`
 * ("GAP tag found") and stall on a black frame — having *some* real segment
 * later in the window does not save it.
 *
 * So wait for a window with NO gaps at all. The placeholders age out as
 * segments rotate (the playback transcode forces a 2s GOP so that takes
 * seconds, not the ~70s the device's 10s keyframe spacing would cost).
 */
async function hasPlayableSegment(
  url: string,
  signal: AbortSignal,
  depth = 0,
): Promise<{ ready: boolean; status: number }> {
  const res = await fetch(url, { method: 'GET', cache: 'no-store', signal });
  if (res.status !== 200) return { ready: false, status: res.status };
  const lines = (await res.text())
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const entries = lines.filter((line) => !line.startsWith('#'));
  if (lines.some((line) => line.startsWith('#EXTINF'))) {
    const hasGap =
      lines.some((line) => line.startsWith('#EXT-X-GAP')) ||
      entries.some((line) => line.startsWith('gap.'));
    return { ready: !hasGap && entries.length > 0, status: 200 };
  }
  // Master playlist — check the first variant it points at.
  const variant = entries[0];
  if (!variant || depth > 2) return { ready: false, status: 200 };
  return hasPlayableSegment(new URL(variant, url).toString(), signal, depth + 1);
}

async function waitForPlaylist(url: string, signal: AbortSignal): Promise<boolean> {
  let attempt = 0;
  while (!signal.aborted) {
    attempt++;
    try {
      const res = await hasPlayableSegment(url, signal);
      // nginx maps MediaMTX's empty-path 404 → 204 so the console stays quiet.
      if (res.ready) {
        mdvrLog(`playlist ready after ${attempt} poll(s): ${url}`);
        return true;
      }
      if (attempt === 1 || attempt % 5 === 0) {
        mdvrLog(
          `waiting for playlist (attempt ${attempt}, HTTP ${res.status}): ${url} — ${
            res.status === 200
              ? 'playlist is up but every entry is still an EXT-X-GAP placeholder; waiting for the first real segment.'
              : res.status === 204
                ? 'MediaMTX has no publisher yet (device has not pushed RTMP to :1935).'
                : 'unexpected status.'
          }`,
        );
      }
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

      const attachHls = () => {
        mdvrLog(`attaching hls.js to ${hlsUrl}`);
        mediaRecoveries = 0;
        hls?.destroy();
        hls = new Hls({
          liveSyncDurationCount: 3,
          liveMaxLatencyDurationCount: 6,
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
                void waitForPlaylist(hlsUrl, ac.signal).then((ok) => {
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
      void waitForPlaylist(hlsUrl, ac.signal).then((ok) => {
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
