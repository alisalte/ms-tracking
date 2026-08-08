/**
 * LiveVideoPlayer — the base `<video>` element that renders a live MediaStream.
 *
 * Forwards the imperative video ref so parent tiles can snapshot the current
 * frame and toggle fullscreen on the player element. Audio is **muted by
 * default** (10 §8.4 — fixed-site audio off by default; consent varies by
 * jurisdiction); the parent controls mute via the `muted` prop.
 */
import { type MutableRefObject, forwardRef, useEffect } from 'react';

interface LiveVideoPlayerProps {
  /** The MediaStream to attach (`video.srcObject`). */
  stream: MediaStream | null;
  /** Mute state — true by default for privacy (10 §8.4). */
  muted?: boolean;
  /** Whether the video is currently playing/active (affects the poster state). */
  active?: boolean;
}

/**
 * Attach the MediaStream to the underlying <video>. Done imperatively because
 * React doesn't manage `srcObject` declaratively.
 */
export const LiveVideoPlayer = forwardRef<HTMLVideoElement, LiveVideoPlayerProps>(
  function LiveVideoPlayer({ stream, muted = true, active = true }, ref) {
    useEffect(() => {
      const el = ref as MutableRefObject<HTMLVideoElement | null>;
      const video = el.current;
      if (!video) return;
      video.srcObject = stream;
      if (stream && active) {
        // Autoplay is allowed when muted; play is best-effort. Some test
        // environments (jsdom) return a non-thenable from play(), so guard it.
        const result = video.play() as unknown as Promise<void> | undefined;
        result?.catch?.(() => {
          /* autoplay blocked — tile controls can resume */
        });
      }
      return () => {
        video.srcObject = null;
      };
    }, [stream, active, ref]);

    return (
      <video
        ref={ref}
        muted={muted}
        playsInline
        autoPlay
        // The canvas-backed stream renders even before metadata loads; this
        // keeps the element styled to fill its tile.
        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
      />
    );
  },
);
