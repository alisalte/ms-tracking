/**
 * useMdvrCapture — take a still from one MDVR camera on demand (D03 → D00).
 *
 * Owns the object URL for the returned JPEG so the caller can just render it.
 * Only one capture runs at a time; a new request supersedes the previous one.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { captureMdvrPhoto } from '@/components/video/useMdvrResources';

export type MdvrCaptureStatus = 'idle' | 'capturing' | 'ready' | 'error';

export interface MdvrCaptureHook {
  status: MdvrCaptureStatus;
  /** Object URL of the captured JPEG, or null. */
  url: string | null;
  blob: Blob | null;
  filename: string | null;
  error: string | null;
  capture: (deviceId: string, camera: number) => void;
  reset: () => void;
}

export function useMdvrCapture(): MdvrCaptureHook {
  const [status, setStatus] = useState<MdvrCaptureStatus>('idle');
  const [blob, setBlob] = useState<Blob | null>(null);
  const [filename, setFilename] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const genRef = useRef(0);
  const urlRef = useRef<string | null>(null);

  const revoke = useCallback(() => {
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
  }, []);

  useEffect(() => () => revoke(), [revoke]);

  const reset = useCallback(() => {
    genRef.current += 1;
    revoke();
    setUrl(null);
    setBlob(null);
    setFilename(null);
    setError(null);
    setStatus('idle');
  }, [revoke]);

  const capture = useCallback(
    (deviceId: string, camera: number) => {
      if (!deviceId) return;
      const gen = ++genRef.current;
      const cancelled = () => gen !== genRef.current;
      revoke();
      setUrl(null);
      setBlob(null);
      setFilename(null);
      setError(null);
      setStatus('capturing');
      void captureMdvrPhoto(deviceId, camera, cancelled)
        .then((result) => {
          if (cancelled()) return;
          const next = URL.createObjectURL(result.blob);
          urlRef.current = next;
          setUrl(next);
          setBlob(result.blob);
          setFilename(result.filename);
          setStatus('ready');
        })
        .catch((err: unknown) => {
          if (cancelled()) return;
          setError(err instanceof Error ? err.message : 'D03 failed');
          setStatus('error');
        });
    },
    [revoke],
  );

  return { status, url, blob, filename, error, capture, reset };
}
