/**
 * AlarmEvidence — MDVR photo/video for an alarm, fetched only after a click.
 *
 * DMS: D00 shows the event JPEG and AB4 plays the clip. Click downloads.
 * Other alarms: list saved files in ±5 minutes.
 */
import { Download, Film, Image as ImageIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { fromMdvrBcdTime } from '@/api/video.api';
import { AlarmEventVideo } from '@/components/alarms/AlarmEventVideo';
import { AlarmPhotoCapture } from '@/components/alarms/AlarmPhotoCapture';
import { Button, Spinner } from '@/components/tailwind-ui';
import type { AlarmMdvrClip } from '@/components/video/useMdvrResources';
import { useAlarmEvidence } from '@/hooks/useAlarmEvidence';
import { formatTime } from '@/lib/format-date';
import { downloadBlob, downloadHlsPlaylist } from '@/lib/video-stream';
import type { Alarm } from '@/types/alarm.types';

interface AlarmEvidenceProps {
  alarm: Alarm;
}

export function AlarmEvidence({ alarm }: AlarmEvidenceProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const evidence = useAlarmEvidence(alarm);

  if (evidence.channelsLoading && !evidence.dms) return null;
  if (!evidence.dms && !evidence.hasCamera) return null;

  const openClip = (clip: AlarmMdvrClip) => {
    const fromMs = fromMdvrBcdTime(clip.resource.startTime);
    let toMs = fromMdvrBcdTime(clip.resource.endTime);
    if (!Number.isFinite(fromMs)) return;
    if (!Number.isFinite(toMs) || toMs <= fromMs) toMs = fromMs + 1_000;
    const params = new URLSearchParams({
      view: 'playback',
      from: new Date(fromMs).toISOString(),
      to: new Date(toMs).toISOString(),
    });
    if (clip.channel.deviceId) params.set('device', clip.channel.deviceId);
    navigate(`/video?${params.toString()}`);
  };

  const downloadPhoto = () => {
    if (!evidence.photoBlob) return;
    downloadBlob(evidence.photoBlob, evidence.eventPhotoName ?? 'event.jpg');
  };

  const downloadVideo = (hlsUrl: string) => {
    const base = (evidence.eventPhotoName ?? 'event').replace(/\.[^.]+$/, '');
    void downloadHlsPlaylist(hlsUrl, `${base}.ts`).catch(() => {
      /* HLS may 404 until the device publishes — ignore a missed click. */
    });
  };

  const idle = evidence.status === 'idle';
  const listing = evidence.status === 'listing';
  const showCatalog = evidence.status === 'ready' || evidence.status === 'error';
  const showEventMedia =
    evidence.dms &&
    !evidence.includeNearby &&
    evidence.loadRequested &&
    evidence.hasCamera &&
    !idle;

  return (
    <div>
      <SectionLabel>{t('alarms.detail.evidence')}</SectionLabel>
      <p className="mt-1 text-xs text-gray-400 dark:text-graydark-600">
        {t(
          evidence.dms && !evidence.includeNearby
            ? 'alarms.detail.dmsEvidence'
            : 'alarms.detail.evidenceWindow',
          { minutes: 5 },
        )}
      </p>

      {evidence.hasCamera && <AlarmPhotoCapture channels={evidence.mdvrChannels} />}

      {idle && !evidence.loadRequested && evidence.hasCamera ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="mt-2"
          onClick={evidence.requestLoad}
        >
          {t(evidence.dms ? 'alarms.detail.loadEvent' : 'alarms.detail.loadNearby', {
            minutes: 5,
          })}
        </Button>
      ) : listing && !evidence.dms ? (
        <div className="mt-2 flex items-center gap-2 text-sm text-gray-500 dark:text-graydark-600">
          <Spinner size="sm" />
          {t('alarms.detail.searchingRecordings')}
        </div>
      ) : evidence.channelsLoading ? null : !evidence.hasCamera ? (
        <p className="mt-1.5 text-sm text-gray-500 dark:text-graydark-600">
          {t(evidence.dms ? 'alarms.detail.dmsNoCamera' : 'alarms.detail.noCamera')}
        </p>
      ) : showEventMedia ? (
        <div className="mt-2 flex flex-col gap-3">
          <div>
            <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-gray-500 dark:text-graydark-600">
              <ImageIcon size={14} aria-hidden />
              {t('alarms.detail.photos')}
            </p>
            {evidence.photoUrl ? (
              <div className="overflow-hidden rounded-lg bg-gray-100 dark:bg-white/5">
                <img
                  src={evidence.photoUrl}
                  alt={evidence.eventPhotoName ?? t('alarms.detail.photos')}
                  className="max-h-64 w-full object-contain"
                />
                <div className="flex items-center justify-between gap-2 px-2 py-1.5">
                  <span className="min-w-0 truncate text-xs text-gray-500 dark:text-graydark-600">
                    {evidence.eventPhotoName}
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    leftIcon={<Download size={14} />}
                    onClick={downloadPhoto}
                  >
                    {t('alarms.detail.downloadPhoto')}
                  </Button>
                </div>
              </div>
            ) : listing ? (
              <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-graydark-600">
                <Spinner size="sm" />
                {t('alarms.detail.loadingEventMedia')}
              </div>
            ) : (
              <p className="text-sm text-gray-500 dark:text-graydark-600">
                {evidence.photoError
                  ? t('alarms.detail.photoError', { message: evidence.photoError })
                  : t('alarms.detail.noEventPhotos')}
              </p>
            )}
          </div>
          <div>
            <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-gray-500 dark:text-graydark-600">
              <Film size={14} aria-hidden />
              {t('alarms.detail.videos')}
            </p>
            {evidence.videoChannel && evidence.videoWindow ? (
              <AlarmEventVideo
                channel={evidence.videoChannel}
                fromMs={evidence.videoWindow.fromMs}
                toMs={evidence.videoWindow.toMs}
                fallbackFromMs={evidence.window?.fromMs}
                fallbackToMs={evidence.window?.toMs}
                fallbackChannels={evidence.mdvrChannels}
                onDownload={downloadVideo}
              />
            ) : (
              <p className="text-sm text-gray-500 dark:text-graydark-600">
                {t('alarms.detail.noEventVideos')}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={evidence.requestNearby}
            className="self-start text-sm font-medium text-brand-600 hover:underline dark:text-brand-400"
          >
            {t('alarms.detail.loadNearby', { minutes: 5 })}
          </button>
        </div>
      ) : evidence.status === 'error' &&
        evidence.videos.length === 0 &&
        evidence.photos.length === 0 &&
        !evidence.photoUrl ? (
        <p className="mt-1.5 text-sm text-warning-600 dark:text-warning-400">
          {t('alarms.detail.evidenceError', { message: evidence.error ?? '' })}
        </p>
      ) : showCatalog ? (
        <div className="mt-2 flex flex-col gap-3">
          <ClipGroup
            title={t('alarms.detail.videos')}
            icon={<Film size={14} aria-hidden />}
            items={evidence.videos}
            empty={t('alarms.detail.noVideos')}
            onOpen={openClip}
          />
          <ClipGroup
            title={t('alarms.detail.photos')}
            icon={<ImageIcon size={14} aria-hidden />}
            items={evidence.photos}
            empty={t('alarms.detail.noPhotos')}
            onOpen={openClip}
          />
        </div>
      ) : listing || (evidence.loadRequested && idle) ? (
        <div className="mt-2 flex items-center gap-2 text-sm text-gray-500 dark:text-graydark-600">
          <Spinner size="sm" />
          {t('alarms.detail.searchingRecordings')}
        </div>
      ) : null}
    </div>
  );
}

function ClipGroup({
  title,
  icon,
  items,
  empty,
  onOpen,
}: {
  title: string;
  icon: ReactNode;
  items: AlarmMdvrClip[];
  empty: string;
  onOpen: (clip: AlarmMdvrClip) => void;
}) {
  return (
    <div>
      <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-gray-500 dark:text-graydark-600">
        {icon}
        {title}
      </p>
      {items.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-graydark-600">{empty}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {items.map((clip) => {
            const fromMs = fromMdvrBcdTime(clip.resource.startTime);
            const label = Number.isFinite(fromMs)
              ? formatTime(fromMs, { second: '2-digit' })
              : clip.resource.startTime;
            return (
              <li key={`${clip.channel.id}-${clip.resource.startTime}-${clip.resource.avType}`}>
                <button
                  type="button"
                  onClick={() => onOpen(clip)}
                  className="w-full truncate rounded-md px-1.5 py-1 text-start text-sm text-brand-600 hover:bg-brand-50 dark:text-brand-400 dark:hover:bg-brand-500/10"
                >
                  {clip.channel.label} · {label}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs font-semibold tracking-wide text-gray-400 uppercase dark:text-graydark-600">
      {children}
    </p>
  );
}
