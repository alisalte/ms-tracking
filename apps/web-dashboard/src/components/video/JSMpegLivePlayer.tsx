/**
 * JSMpegLivePlayer — the real MDVR live path renderer.
 *
 * Draws the mdvr-streamer's binary MPEG-TS WebSocket stream onto a canvas via
 * the vendored JSMpeg decoder (the same player the standalone MD300 pipeline
 * validated). Forwards the canvas ref so tiles can snapshot frames and toggle
 * fullscreen, mirroring LiveVideoPlayer's imperative contract.
 */
import { forwardRef, useEffect, useRef } from 'react';

import { startJSMpegPlayer } from '@/lib/video-stream';

interface JSMpegLivePlayerProps {
  /** The binary MPEG-TS WebSocket URL (`…/media-live/ws?imei=…`). */
  wsUrl: string | null;
  /** Fires once decoding + rendering actually start (drives session state). */
  onReady?: () => void;
}

export const JSMpegLivePlayer = forwardRef<HTMLCanvasElement, JSMpegLivePlayerProps>(
  function JSMpegLivePlayer({ wsUrl, onReady }, ref) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const onReadyRef = useRef(onReady);
    onReadyRef.current = onReady;

    useEffect(() => {
      if (!wsUrl) return;
      let destroyed = false;
      // Typed loosely: the vendored player instance is opaque beyond its API.
      let player: { destroy(): void } | null = null;
      const canvas = canvasRef.current;

      if (canvas) {
        void startJSMpegPlayer(wsUrl, canvas, {
          onSourceEstablished: () => {
            if (!destroyed) onReadyRef.current?.();
          },
        })
          .then((p) => {
            if (destroyed) p.destroy();
            else player = p;
          })
          .catch(() => {
            /* load failure leaves the tile in its connecting overlay → timeout */
          });
      }

      return () => {
        destroyed = true;
        player?.destroy();
        player = null;
      };
    }, [wsUrl]);

    return (
      <canvas
        ref={(el) => {
          canvasRef.current = el;
          if (typeof ref === 'function') ref(el);
          else if (ref) ref.current = el;
        }}
        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
      />
    );
  },
);
