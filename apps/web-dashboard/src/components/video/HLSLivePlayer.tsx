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
}

const POLL_MS = 2000;

/** Console tag so `[MDVR]` is easy to filter/search in devtools. */
function mdvrLog(...args: unknown[]): void {
  // eslint-disable-next-line no-console
  console.log('[MDVR]', ...args);
}

async function waitForPlaylist(url: string, signal: AbortSignal): Promise<boolean> {
  let attempt = 0;
  while (!signal.aborted) {
    attempt++;
    try {
      const res = await fetch(url, { method: 'GET', cache: 'no-store', signal });
      // nginx maps MediaMTX's empty-path 404 → 204 so the console stays quiet.
      if (res.status === 200) {
        mdvrLog(`playlist ready after ${attempt} poll(s): ${url}`);
        return true;
      }
      if (attempt === 1 || attempt % 5 === 0) {
        mdvrLog(
          `waiting for playlist (attempt ${attempt}, HTTP ${res.status}): ${url} — ${
            res.status === 204
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
  function HLSLivePlayer({ hlsUrl, muted = true, onReady }, ref) {
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

      const attachHls = () => {
        mdvrLog(`attaching hls.js to ${hlsUrl}`);
        hls?.destroy();
        hls = new Hls({
          liveSyncDurationCount: 3,
          liveMaxLatencyDurationCount: 6,
          enableWorker: true,
          lowLatencyMode: true,
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
            mdvrLog(`hls.js media error — attempting recoverMediaError(): ${hlsUrl}`);
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
    }, [hlsUrl]);

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
        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
      />
    );
  },
);
