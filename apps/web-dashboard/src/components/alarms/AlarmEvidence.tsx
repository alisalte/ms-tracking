/**
 * AlarmEvidence — MDVR recordings around the alarm time.
 *
 * Any camera-equipped vehicle lists video in a ±5 minute window. DMS alarms
 * always surface that section and also query stills (plus `photoName` from
 * the device event when the gateway attached it).
 */
import { Film, Image as ImageIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { fromMdvrBcdTime } from '@/api/video.api';
import { Spinner } from '@/components/tailwind-ui';
import type { AlarmMdvrClip } from '@/components/video/useMdvrResources';
import { useAlarmEvidence } from '@/hooks/useAlarmEvidence';
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

  const openWindow = () => {
    const ch = evidence.mdvrChannels[0];
    if (!ch?.deviceId || !evidence.window) return;
    const params = new URLSearchParams({
      view: 'playback',
      device: ch.deviceId,
      from: new Date(evidence.window.fromMs).toISOString(),
      to: new Date(evidence.window.toMs).toISOString(),
    });
    navigate(`/video?${params.toString()}`);
  };

  return (
    <div>
      <SectionLabel>{t('alarms.detail.evidence')}</SectionLabel>
      <p className="mt-1 text-xs text-gray-400 dark:text-graydark-600">
        {t('alarms.detail.evidenceWindow', { minutes: 5 })}
      </p>

      {evidence.eventPhotoName && (
        <p className="mt-1.5 text-sm text-gray-700 dark:text-graydark-700">
          {t('alarms.detail.eventPhoto', { name: evidence.eventPhotoName })}
        </p>
      )}

      {evidence.channelsLoading || evidence.status === 'listing' ? (
        <div className="mt-2 flex items-center gap-2 text-sm text-gray-500 dark:text-graydark-600">
          <Spinner size="sm" label={t('alarms.detail.searchingRecordings')} />
          {t('alarms.detail.searchingRecordings')}
        </div>
      ) : !evidence.hasCamera ? (
        <p className="mt-1.5 text-sm text-gray-500 dark:text-graydark-600">
          {t(evidence.dms ? 'alarms.detail.dmsNoCamera' : 'alarms.detail.noCamera')}
        </p>
      ) : evidence.status === 'error' &&
        evidence.videos.length === 0 &&
        evidence.photos.length === 0 ? (
        <p className="mt-1.5 text-sm text-warning-600 dark:text-warning-400">
          {t('alarms.detail.evidenceError', { message: evidence.error ?? '' })}
        </p>
      ) : (
        <div className="mt-2 flex flex-col gap-3">
          <ClipGroup
            title={t('alarms.detail.videos')}
            icon={<Film size={14} aria-hidden />}
            items={evidence.videos}
            empty={t('alarms.detail.noVideos')}
            onOpen={openClip}
          />
          {evidence.dms && (
            <ClipGroup
              title={t('alarms.detail.photos')}
              icon={<ImageIcon size={14} aria-hidden />}
              items={evidence.photos}
              empty={t('alarms.detail.noPhotos')}
              onOpen={openClip}
            />
          )}
          <button
            type="button"
            onClick={openWindow}
            className="self-start text-sm font-medium text-brand-600 hover:underline dark:text-brand-400"
          >
            {t('alarms.detail.openPlayback')}
          </button>
        </div>
      )}
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
              ? new Date(fromMs).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                })
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
