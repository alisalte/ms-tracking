/**
 * AlarmEventVideo — AB4 HLS of the event clip, with a separate download.
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
  onDownload: (hlsUrl: string) => void;
}

export function AlarmEventVideo({ channel, fromMs, toMs, onDownload }: AlarmEventVideoProps) {
  const { t } = useTranslation();
  const playback = useMdvrPlayback();
  const startRef = useRef(playback.start);
  const stopRef = useRef(playback.stop);
  startRef.current = playback.start;
  stopRef.current = playback.stop;

  useEffect(() => {
    void startRef.current(channel, fromMs, toMs);
    return () => {
      void stopRef.current();
    };
  }, [channel, fromMs, toMs]);

  const busy = playback.status === 'starting' || playback.status === 'waiting';

  return (
    <div className="overflow-hidden rounded-lg bg-gray-950">
      <div className="relative aspect-video w-full">
        {playback.hlsUrl ? (
          <HLSLivePlayer
            hlsUrl={playback.hlsUrl}
            muted
            objectFit="contain"
            onReady={playback.onPlayerReady}
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
            {t('alarms.detail.videoError', { message: playback.error ?? '' })}
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
