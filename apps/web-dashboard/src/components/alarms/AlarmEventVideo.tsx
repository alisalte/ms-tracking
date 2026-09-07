/**
 * AlarmEventVideo — AB4 HLS of the event clip, with a separate download.
 *
 * Photo filenames often carry a device clock that is days/years off `raisedAt`.
 * We play the alarm-time window first; on FFF5 (no file) retry the ±5 minute
 * evidence window and the other cameras on the same MDVR.
 */
import { Download } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { Button, Spinner } from '@/components/tailwind-ui';
import { HLSLivePlayer } from '@/components/video/HLSLivePlayer';
import { useMdvrPlayback } from '@/components/video/useMdvrPlayback';
import type { CameraChannel } from '@/types/video.types';

interface AlarmEventVideoProps {
  channel: CameraChannel;
  fromMs: number;
  toMs: number;
  fallbackFromMs?: number;
  fallbackToMs?: number;
  fallbackChannels?: CameraChannel[];
  onDownload: (hlsUrl: string) => void;
}

function isNoFile(message: string | null): boolean {
  return /FFF5/i.test(message ?? '');
}

function sameWindow(aFrom: number, aTo: number, bFrom: number, bTo: number): boolean {
  return Math.abs(aFrom - bFrom) < 1_000 && Math.abs(aTo - bTo) < 1_000;
}

export function AlarmEventVideo({
  channel,
  fromMs,
  toMs,
  fallbackFromMs,
  fallbackToMs,
  fallbackChannels,
  onDownload,
}: AlarmEventVideoProps) {
  const { t } = useTranslation();
  const playback = useMdvrPlayback();
  const startRef = useRef(playback.start);
  const stopRef = useRef(playback.stop);
  startRef.current = playback.start;
  stopRef.current = playback.stop;

  useEffect(() => {
    let cancelled = false;
    const attempts: Array<{ ch: CameraChannel; from: number; to: number }> = [
      { ch: channel, from: fromMs, to: toMs },
    ];
    if (
      fallbackFromMs != null &&
      fallbackToMs != null &&
      !sameWindow(fromMs, toMs, fallbackFromMs, fallbackToMs)
    ) {
      attempts.push({ ch: channel, from: fallbackFromMs, to: fallbackToMs });
    }
    const nearbyFrom = fallbackFromMs ?? fromMs;
    const nearbyTo = fallbackToMs ?? toMs;
    for (const extra of fallbackChannels ?? []) {
      if (extra.id === channel.id) continue;
      attempts.push({ ch: extra, from: nearbyFrom, to: nearbyTo });
    }

    void (async () => {
      for (const attempt of attempts) {
        if (cancelled) return;
        const ok = await startRef.current(attempt.ch, attempt.from, attempt.to, '0');
        if (cancelled || ok) return;
      }
    })();

    return () => {
      cancelled = true;
      void stopRef.current();
    };
  }, [channel, fromMs, toMs, fallbackFromMs, fallbackToMs, fallbackChannels]);

  const busy = playback.status === 'starting' || playback.status === 'waiting';
  const errorMessage = isNoFile(playback.error)
    ? t('alarms.detail.videoMissing')
    : t('alarms.detail.videoError', { message: playback.error ?? '' });

  return (
    <div className="overflow-hidden rounded-lg bg-gray-950">
      <div className="relative aspect-video w-full">
        {playback.hlsUrl ? (
          <HLSLivePlayer
            key={playback.playerKey}
            hlsUrl={playback.hlsUrl}
            muted
            objectFit="contain"
            onReady={playback.onPlayerReady}
            lowLatencyMode={false}
          />
        ) : null}
        {busy ? (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-xs text-white">
            <Spinner size="sm" />
            <span className="ms-2">{t('alarms.detail.loadingVideo')}</span>
          </div>
        ) : null}
        {playback.status === 'error' ? (
          <div className="absolute inset-0 flex items-center justify-center px-3 text-center text-xs text-warning-200">
            {errorMessage}
          </div>
        ) : null}
      </div>
      <div className="flex justify-end px-2 py-1.5">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!playback.hlsUrl}
          leftIcon={<Download size={14} />}
          onClick={() => {
            if (playback.hlsUrl) onDownload(playback.hlsUrl);
          }}
        >
          {t('alarms.detail.downloadVideo')}
        </Button>
      </div>
    </div>
  );
}
