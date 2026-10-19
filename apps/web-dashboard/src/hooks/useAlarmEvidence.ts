/**
 * Load MDVR recordings around an alarm — only after the operator asks.
 *
 * DMS with a `photoName`: D00 downloads that JPEG and AB4 plays the event
 * clip (no AB8 wait). Other alarms list saved files in ±5 minutes via AB8.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { fetchAlarmEvidencePhoto, useAlarmPlatformEvidence } from '@/api/alarm.api';
import { useChannels } from '@/api/video.api';
import {
  type AlarmMdvrClip,
  type MdvrResourceStatus,
  fetchEventPhoto,
  listMdvrEvidence,
} from '@/components/video/useMdvrResources';
import {
  alarmEventMediaHint,
  alarmEventVideoWindow,
  alarmEvidenceWindow,
  evidenceChannelForPhoto,
  isDmsAlarm,
  mdvrChannelsForVehicle,
  needsPhotoEvidence,
  parseMdvrEventPhotoName,
  selectAlarmEventClips,
  sortEvidenceChannels,
} from '@/lib/alarm-evidence';
import { shouldUseMock } from '@/lib/mock-gate';
import type { Alarm } from '@/types/alarm.types';
import type { CameraChannel } from '@/types/video.types';

const EMPTY_CHANNELS: CameraChannel[] = [];

export function useAlarmEvidence(alarm: Alarm) {
  const { data, isLoading: channelsLoading, isFetched } = useChannels();
  const channels = data ?? EMPTY_CHANNELS;
  const platform = useAlarmPlatformEvidence(alarm.id, needsPhotoEvidence(alarm));
  const [status, setStatus] = useState<MdvrResourceStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [listedVideos, setListedVideos] = useState<AlarmMdvrClip[]>([]);
  const [listedPhotos, setListedPhotos] = useState<AlarmMdvrClip[]>([]);
  const [photoBlob, setPhotoBlob] = useState<Blob | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [session, setSession] = useState({
    alarmId: alarm.id,
    loadRequested: false,
    includeNearby: false,
  });
  if (session.alarmId !== alarm.id) {
    setSession({ alarmId: alarm.id, loadRequested: false, includeNearby: false });
  }
  const genRef = useRef(0);

  const dms = isDmsAlarm(alarm);
  const criticalEvidence = needsPhotoEvidence(alarm);
  const mediaHint = useMemo(() => alarmEventMediaHint(alarm), [alarm]);
  const eventPhotoName = mediaHint.photoName;
  const eventMedia = dms || Boolean(eventPhotoName);
  const eventPhoto = useMemo(() => parseMdvrEventPhotoName(eventPhotoName), [eventPhotoName]);
  const window = useMemo(() => alarmEvidenceWindow(alarm.raisedAt), [alarm.raisedAt]);
  const raisedAtMs = useMemo(() => new Date(alarm.raisedAt).getTime(), [alarm.raisedAt]);
  const mdvrChannels = useMemo(
    () => sortEvidenceChannels(mdvrChannelsForVehicle(channels, alarm.vehicleId)),
    [channels, alarm.vehicleId],
  );
  const videoWindow = useMemo(() => {
    const fromIso = platform.data?.videoWindowFrom;
    const toIso = platform.data?.videoWindowTo;
    if (fromIso && toIso) {
      const fromMs = new Date(fromIso).getTime();
      const toMs = new Date(toIso).getTime();
      if (Number.isFinite(fromMs) && Number.isFinite(toMs) && toMs > fromMs) {
        return { fromMs, toMs };
      }
    }
    return alarmEventVideoWindow(eventPhoto, alarm.raisedAt);
  }, [platform.data?.videoWindowFrom, platform.data?.videoWindowTo, eventPhoto, alarm.raisedAt]);

  const videoChannel = useMemo(() => {
    const preferred = platform.data?.videoChannel;
    if (preferred != null) {
      const match = mdvrChannels.find((c) => (c.logicalChannel ?? 1) === preferred);
      if (match) return match;
    }
    return evidenceChannelForPhoto(mdvrChannels, eventPhoto) ?? null;
  }, [mdvrChannels, eventPhoto, platform.data?.videoChannel]);
  const hasCamera = mdvrChannels.length > 0;
  const deviceId = mdvrChannels[0]?.deviceId ?? '';
  const cameraKey = mdvrChannels.map((c) => `${c.id}:${c.logicalChannel ?? 1}`).join('|');
  const mdvrChannelsRef = useRef(mdvrChannels);
  mdvrChannelsRef.current = mdvrChannels;
  const loadRequested = session.alarmId === alarm.id && session.loadRequested;
  const includeNearby = session.alarmId === alarm.id && session.includeNearby;
  const shouldFetch = loadRequested;
  const photoOnServer = platform.data?.photoAvailable === true;
  const serverFetching =
    platform.data?.status === 'PENDING' || platform.data?.status === 'FETCHING';
  const platformSettled = platform.isFetched || platform.isError;
  const [giveUpServerPhoto, setGiveUpServerPhoto] = useState(false);
  const photoUrl = useMemo(() => (photoBlob ? URL.createObjectURL(photoBlob) : null), [photoBlob]);

  useEffect(() => {
    if (!alarm.id) return;
    setGiveUpServerPhoto(false);
    if (!serverFetching) return;
    const timer = setTimeout(() => setGiveUpServerPhoto(true), 20_000);
    return () => clearTimeout(timer);
  }, [alarm.id, serverFetching]);

  useEffect(() => {
    return () => {
      if (photoUrl) URL.revokeObjectURL(photoUrl);
    };
  }, [photoUrl]);

  useEffect(() => {
    const gen = ++genRef.current;
    const cancelled = () => gen !== genRef.current;
    if (!window || !shouldFetch) {
      setStatus('idle');
      setListedVideos([]);
      setListedPhotos([]);
      setPhotoBlob(null);
      setPhotoError(null);
      setError(null);
      return;
    }
    if (channelsLoading || !isFetched) {
      setStatus('idle');
      return;
    }

    setListedVideos([]);
    setListedPhotos([]);
    setPhotoBlob(null);
    setPhotoError(null);
    setError(null);
    if (!hasCamera) {
      setStatus('ready');
      return;
    }
    if (shouldUseMock()) {
      setStatus('ready');
      return;
    }

    const cameras = cameraKey ? mdvrChannelsRef.current : [];
    const eventMode = eventMedia && !includeNearby;
    // The photo URL 404s until fleet-management has stored the JPEG. Hitting it
    // anyway, then starting a second D00, collides with the server download.
    const waitForServerPhoto =
      !platformSettled || (serverFetching && !giveUpServerPhoto && !photoOnServer);
    if (eventMode && waitForServerPhoto) {
      setStatus('listing');
      return;
    }
    setStatus('listing');

    void (async () => {
      const errors: string[] = [];
      let gotPhoto = false;
      let listed = 0;
      if (eventMode && photoOnServer) {
        try {
          const platformPhoto = await fetchAlarmEvidencePhoto(alarm.id);
          if (cancelled()) return;
          setPhotoBlob(platformPhoto);
          gotPhoto = true;
        } catch {
          /* fall through to device D00 */
        }
      }
      if (!gotPhoto && eventMode && eventPhotoName && deviceId) {
        try {
          const photo = await fetchEventPhoto(deviceId, eventPhotoName, cancelled);
          if (cancelled()) return;
          setPhotoBlob(photo.blob);
          gotPhoto = true;
        } catch (err) {
          if (cancelled() || (err instanceof Error && err.message === 'cancelled')) return;
          setPhotoError(err instanceof Error ? err.message : 'D00 failed');
          errors.push(err instanceof Error ? err.message : 'D00 failed');
        }
      }
      if (!eventMode) {
        try {
          const result = await listMdvrEvidence(
            cameras,
            window.fromMs,
            window.toMs,
            true,
            cancelled,
          );
          if (cancelled()) return;
          setListedVideos(result.videos);
          setListedPhotos(result.photos);
          listed = result.videos.length + result.photos.length;
          if (result.error) errors.push(result.error);
        } catch (err) {
          if (cancelled() || (err instanceof Error && err.message === 'cancelled')) return;
          errors.push(err instanceof Error ? err.message : 'AB8 failed');
        }
      }
      if (cancelled()) return;
      if (errors.length > 0 && !gotPhoto && listed === 0 && !eventMode) {
        setStatus('error');
        setError(errors[0] ?? null);
        return;
      }
      setStatus('ready');
      setError(errors[0] ?? null);
    })();

    return () => {
      genRef.current += 1;
    };
  }, [
    alarm.id,
    cameraKey,
    channelsLoading,
    deviceId,
    eventMedia,
    eventPhotoName,
    giveUpServerPhoto,
    hasCamera,
    includeNearby,
    isFetched,
    photoOnServer,
    platformSettled,
    serverFetching,
    shouldFetch,
    window,
  ]);

  const eventVideos = useMemo(
    () =>
      Number.isFinite(raisedAtMs)
        ? selectAlarmEventClips(listedVideos, mediaHint, raisedAtMs)
        : listedVideos,
    [listedVideos, mediaHint, raisedAtMs],
  );
  const eventPhotos = useMemo(
    () =>
      Number.isFinite(raisedAtMs)
        ? selectAlarmEventClips(listedPhotos, mediaHint, raisedAtMs)
        : listedPhotos,
    [listedPhotos, mediaHint, raisedAtMs],
  );

  const showEventOnly = eventMedia && !includeNearby;
  const videos = showEventOnly ? eventVideos : listedVideos;
  const photos = showEventOnly ? eventPhotos : listedPhotos;
  const hasNearbyExtras =
    dms && (listedVideos.length > eventVideos.length || listedPhotos.length > eventPhotos.length);

  const requestLoad = useCallback(() => {
    setSession({ alarmId: alarm.id, loadRequested: true, includeNearby: false });
  }, [alarm.id]);

  const requestNearby = useCallback(() => {
    setSession({ alarmId: alarm.id, loadRequested: true, includeNearby: true });
  }, [alarm.id]);

  // Accident / SOS / DMS: pull evidence as soon as an MDVR camera is known —
  // operators should not hunt for a "Load" button on life-safety alarms.
  useEffect(() => {
    if (!criticalEvidence || !hasCamera || loadRequested || channelsLoading || !isFetched) return;
    if (eventMedia) requestLoad();
    else requestNearby();
  }, [
    criticalEvidence,
    hasCamera,
    loadRequested,
    channelsLoading,
    isFetched,
    eventMedia,
    requestLoad,
    requestNearby,
  ]);

  return {
    dms: eventMedia || criticalEvidence,
    eventPhotoName,
    eventPhoto,
    photoUrl,
    photoBlob,
    photoError,
    videoChannel,
    videoWindow,
    window,
    hasCamera,
    channelsLoading,
    status,
    error,
    videos,
    photos,
    mdvrChannels,
    loadRequested,
    includeNearby,
    hasNearbyExtras,
    requestLoad,
    requestNearby,
  };
}
