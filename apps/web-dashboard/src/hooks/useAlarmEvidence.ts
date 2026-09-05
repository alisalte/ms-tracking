/**
 * Load MDVR recordings around an alarm (±5 minutes). Photos are queried only
 * for DMS so a fatigue/distraction event always has a still if the device
 * stored one.
 */
import { useEffect, useMemo, useRef, useState } from 'react';

import { useChannels } from '@/api/video.api';
import {
  type AlarmMdvrClip,
  type MdvrResourceStatus,
  listMdvrEvidence,
} from '@/components/video/useMdvrResources';
import {
  alarmEventPhotoName,
  alarmEvidenceWindow,
  isDmsAlarm,
  mdvrChannelsForVehicle,
  sortEvidenceChannels,
} from '@/lib/alarm-evidence';
import { shouldUseMock } from '@/lib/mock-gate';
import type { Alarm } from '@/types/alarm.types';
import type { CameraChannel } from '@/types/video.types';

const EMPTY_CHANNELS: CameraChannel[] = [];

export function useAlarmEvidence(alarm: Alarm) {
  const { data, isLoading: channelsLoading, isFetched } = useChannels();
  const channels = data ?? EMPTY_CHANNELS;
  const [status, setStatus] = useState<MdvrResourceStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [videos, setVideos] = useState<AlarmMdvrClip[]>([]);
  const [photos, setPhotos] = useState<AlarmMdvrClip[]>([]);
  const genRef = useRef(0);

  const dms = isDmsAlarm(alarm);
  const eventPhotoName = alarmEventPhotoName(alarm.detail);
  const window = useMemo(() => alarmEvidenceWindow(alarm.raisedAt), [alarm.raisedAt]);
  const mdvrChannels = useMemo(
    () => sortEvidenceChannels(mdvrChannelsForVehicle(channels, alarm.vehicleId)),
    [channels, alarm.vehicleId],
  );
  const hasCamera = mdvrChannels.length > 0;

  useEffect(() => {
    const gen = ++genRef.current;
    if (!window) {
      setStatus('idle');
      setVideos([]);
      setPhotos([]);
      setError(null);
      return;
    }
    if (channelsLoading || !isFetched) {
      setStatus('idle');
      return;
    }

    setVideos([]);
    setPhotos([]);
    setError(null);
    if (!hasCamera) {
      setStatus('ready');
      return;
    }
    // Demo/mock catalogs have no MDVR command plane — don't hang the drawer.
    if (shouldUseMock()) {
      setStatus('ready');
      return;
    }

    setStatus('listing');
    void listMdvrEvidence(
      mdvrChannels,
      window.fromMs,
      window.toMs,
      dms,
      () => gen !== genRef.current,
    )
      .then((result) => {
        if (gen !== genRef.current) return;
        setVideos(result.videos);
        setPhotos(result.photos);
        if (result.error && result.videos.length === 0 && result.photos.length === 0) {
          setStatus('error');
          setError(result.error);
          return;
        }
        setStatus('ready');
        setError(result.error);
      })
      .catch((err: unknown) => {
        if (gen !== genRef.current) return;
        setStatus('error');
        setError(err instanceof Error ? err.message : 'AB8 failed');
      });

    return () => {
      genRef.current += 1;
    };
  }, [channelsLoading, dms, hasCamera, isFetched, mdvrChannels, window]);

  return {
    dms,
    eventPhotoName,
    window,
    hasCamera,
    channelsLoading,
    status,
    error,
    videos,
    photos,
    mdvrChannels,
  };
}
