/**
 * PlaybackPanel — recorded video from the MDVR SD card (AB8 list → AB4 HLS)
 * and still photos (D01 names → D00 JPEG). Clicking a video waits for AB4 to
 * retarget RTMP before HLS attaches, so the live camera is not shown by
 * mistake. Clicking a photo downloads the JPEG instead of sending AB4.
 */
import {
  AlertTriangle,
  Film,
  Image,
  ImageDown,
  Maximize2,
  Pause,
  Play,
  RotateCcw,
  Square,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { type MdvrResource, fromMdvrBcdTime, useSnapshot } from '@/api/video.api';
import { Alert, Badge, Input, Spinner } from '@/components/tailwind-ui';
import { HLSLivePlayer } from '@/components/video/HLSLivePlayer';
import { useMdvrPlayback } from '@/components/video/useMdvrPlayback';
import { fetchMdvrPhoto, useMdvrResources } from '@/components/video/useMdvrResources';
import { isMdvrChannel } from '@/components/video/useStreamSession';
import { formatDateTime, formatTime } from '@/lib/format-date';
import { downloadBlob, toggleFullscreen } from '@/lib/video-stream';
import type { CameraChannel } from '@/types/video.types';

/** Playback playhead advance rate (ms of recording per real second), 1×. */
const PLAYBACK_MS_PER_SECOND = 1000;
const CLIP_PLAYBACK_SPEEDS = [0.5, 1, 2, 4, 8] as const;
type ClipPlaybackSpeed = (typeof CLIP_PLAYBACK_SPEEDS)[number];

/** Wait for the drag to settle before sending one AB5 seek to the device. */
const SEEK_DEBOUNCE_MS = 500;

function fmtTime(ms: number): string {
  return formatTime(ms, { second: '2-digit' });
}
function fmtFull(ms: number): string {
  return formatDateTime(ms);
}
function startOfLocalDay(ms = Date.now()): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
function toDateInput(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function parseIsoToInput(iso: string | null | undefined, fallbackMs: number): string {
  if (!iso) return toDateInput(fallbackMs);
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? toDateInput(ms) : toDateInput(fallbackMs);
}
function fmtBytes(n: number): string {
  if (n <= 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
function clipWindow(r: MdvrResource): { fromMs: number; toMs: number } | null {
  const fromMs = fromMdvrBcdTime(r.startTime);
  let toMs = fromMdvrBcdTime(r.endTime);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) return null;
  if (toMs <= fromMs) toMs = fromMs + 1_000;
  return { fromMs, toMs };
}

function photoFilenameOf(r: MdvrResource): string {
  const named = r.filename?.trim();
  if (named) return named;
  return /^\d{12}$/.test(r.startTime) ? `${r.startTime}.jpg` : '';
}

type PhotoStage =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; url: string; filename: string }
  | { status: 'error'; message: string };

interface PlaybackPanelProps {
  channels: CameraChannel[];
  /** Preselect this device's first MDVR camera (alarm → playback deep link). */
  initialDeviceId?: string | null;
  /** ISO start of the alarm evidence window. */
  initialFrom?: string | null;
  /** ISO end of the alarm evidence window. */
  initialTo?: string | null;
}

export function PlaybackPanel({
  channels,
  initialDeviceId,
  initialFrom,
  initialTo,
}: PlaybackPanelProps) {
  const { t } = useTranslation();
  const available = useMemo(() => channels.filter((c) => c.online && c.consentGiven), [channels]);
  const hasMdvr = useMemo(() => channels.some((c) => isMdvrChannel(c)), [channels]);
  const playback = useMdvrPlayback();
  const {
    search: searchResources,
    status: resourceStatus,
    error: resourceError,
    videos,
    photos,
  } = useMdvrResources();

  const [channelId, setChannelId] = useState('');
  const [fromInput, setFromInput] = useState(() => parseIsoToInput(initialFrom, startOfLocalDay()));
  const [toInput, setToInput] = useState(() => parseIsoToInput(initialTo, Date.now()));

  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const [speed, setSpeed] = useState<ClipPlaybackSpeed>(1);
  const [cursorMs, setCursorMs] = useState<number | null>(null);
  const snapshot = useSnapshot();
  const lastTickRef = useRef(0);
  const seekTimerRef = useRef<number | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const photoUrlRef = useRef<string | null>(null);
  const photoGenRef = useRef(0);
  const [photo, setPhoto] = useState<PhotoStage>({ status: 'idle' });

  const from = new Date(fromInput).getTime();
  const to = new Date(toInput).getTime();
  const rangeValid = Number.isFinite(from) && Number.isFinite(to) && to > from;
  const windowMs = rangeValid ? to - from : 0;

  const channel = available.find((c) => c.id === channelId) ?? null;
  const mdvr = isMdvrChannel(channel);
  const hasRecordingContext = channel !== null && cursorMs !== null;
  const viewingPhoto = photo.status !== 'idle';
  const busy =
    playback.status === 'starting' || resourceStatus === 'listing' || photo.status === 'loading';
  const deepLinkApplied = useRef(false);

  const revokePhotoUrl = () => {
    if (photoUrlRef.current) {
      URL.revokeObjectURL(photoUrlRef.current);
      photoUrlRef.current = null;
    }
  };

  const clearPhoto = () => {
    photoGenRef.current += 1;
    revokePhotoUrl();
    setPhoto({ status: 'idle' });
  };

  useEffect(
    () => () => {
      if (photoUrlRef.current) URL.revokeObjectURL(photoUrlRef.current);
      if (seekTimerRef.current !== null) window.clearTimeout(seekTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    if (deepLinkApplied.current) return;
    if (!initialDeviceId && !initialFrom) return;
    const mine = channels
      .filter((c) => isMdvrChannel(c) && (!initialDeviceId || c.deviceId === initialDeviceId))
      .sort((a, b) => (a.logicalChannel ?? 99) - (b.logicalChannel ?? 99));
    const ch = mine[0];
    if (!ch) return;
    deepLinkApplied.current = true;
    setChannelId(ch.id);
    const fromMs = initialFrom ? Date.parse(initialFrom) : Number.NaN;
    const toMs = initialTo ? Date.parse(initialTo) : Number.NaN;
    if (Number.isFinite(fromMs) && Number.isFinite(toMs) && toMs > fromMs) {
      setFromInput(toDateInput(fromMs));
      setToInput(toDateInput(toMs));
      void searchResources(ch, fromMs, toMs);
    }
  }, [channels, initialDeviceId, initialFrom, initialTo, searchResources]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: cursorMs gates start; ticks use functional setState
  useEffect(() => {
    if (!playing || cursorMs === null) return;
    // Hold the playhead until the device is actually streaming the clip
    // (AB2 → AB4 → MediaMTX transcode takes ~10s). Advancing during the wait
    // runs the cursor past the end of the window before the first frame
    // arrives, which pauses the video the moment it becomes ready.
    if (mdvr && playback.status !== 'ready') return;
    lastTickRef.current = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now();
      const dt = now - lastTickRef.current;
      lastTickRef.current = now;
      setCursorMs((prev) => {
        if (prev === null) return prev;
        // `dt` is already milliseconds — scale by the rate per real SECOND.
        const next = prev + (dt * PLAYBACK_MS_PER_SECOND * speed) / 1000;
        if (next >= to) {
          setPlaying(false);
          return to;
        }
        return next;
      });
    }, 250);
    return () => {
      window.clearInterval(timer);
    };
  }, [playing, to, mdvr, playback.status, speed]);

  useEffect(() => {
    if (playback.status === 'ready') setPlaying(true);
  }, [playback.status]);

  useEffect(() => {
    if (playback.status !== 'ready') return;
    const video = videoRef.current;
    if (!video) return;
    video.playbackRate = speed;
    if (playing) void video.play()?.catch(() => undefined);
    else video.pause();
  }, [playing, playback.status, speed]);

  const beginPlayback = (ch: CameraChannel, fromMs: number, toMs: number, avType = '0') => {
    clearPhoto();
    setFromInput(toDateInput(fromMs));
    setToInput(toDateInput(toMs));
    setPlaying(Boolean(isMdvrChannel(ch)));
    setCursorMs(fromMs);
    if (isMdvrChannel(ch)) void playback.start(ch, fromMs, toMs, avType);
    else void playback.stop();
  };

  const load = () => {
    if (!rangeValid || !channel) return;
    beginPlayback(channel, from, to);
  };

  const search = () => {
    if (!rangeValid || !channel || !mdvr) return;
    void searchResources(channel, from, to);
  };

  const playResource = (r: MdvrResource) => {
    if (!channel) return;
    const win = clipWindow(r);
    if (!win) return;
    beginPlayback(channel, win.fromMs, win.toMs, String(r.avType ?? 0));
  };

  const viewPhoto = (r: MdvrResource) => {
    if (!channel?.deviceId) return;
    const filename = photoFilenameOf(r);
    setPlaying(false);
    setCursorMs(null);
    void playback.stop();
    revokePhotoUrl();
    if (!filename) {
      setPhoto({ status: 'error', message: 'no-filename' });
      return;
    }
    const gen = ++photoGenRef.current;
    setPhoto({ status: 'loading' });
    void fetchMdvrPhoto(channel.deviceId, filename, () => gen !== photoGenRef.current)
      .then((result) => {
        if (gen !== photoGenRef.current) return;
        const url = URL.createObjectURL(result.blob);
        photoUrlRef.current = url;
        setPhoto({ status: 'ready', url, filename: result.filename });
      })
      .catch((err: unknown) => {
        if (gen !== photoGenRef.current) return;
        setPhoto({
          status: 'error',
          message: err instanceof Error ? err.message : 'D00 failed',
        });
      });
  };

  /**
   * Move the playhead. The range input fires `change` for every pixel of a
   * drag, so the device seek is debounced — sending an AB5 drag per event
   * floods the MDVR (observed: 7 AB5s in 0.24s) and it drops the stream.
   * The local cursor still tracks the drag so the UI stays smooth.
   */
  const seek = (value: number) => {
    setCursorMs(value);
    if (!mdvr) return;
    if (seekTimerRef.current !== null) window.clearTimeout(seekTimerRef.current);
    seekTimerRef.current = window.setTimeout(() => {
      seekTimerRef.current = null;
      if (playback.status === 'ready') void playback.seekDevice(value);
    }, SEEK_DEBOUNCE_MS);
  };

  const stopAll = () => {
    setPlaying(false);
    setCursorMs(null);
    clearPhoto();
    void playback.stop();
  };

  const canSnapshot =
    photo.status === 'ready' || (Boolean(playback.hlsUrl) && playback.status === 'ready');

  const takeSnapshot = () => {
    if (photo.status === 'ready') {
      void fetch(photo.url)
        .then((res) => res.blob())
        .then((blob) => downloadBlob(blob, photo.filename));
      return;
    }
    if (!channel || !videoRef.current) return;
    snapshot.mutate({ video: videoRef.current, channelId: channel.id });
  };

  const overlay = viewingPhoto
    ? photo.status === 'loading'
      ? 'photo-waiting'
      : photo.status === 'error'
        ? 'photo-error'
        : null
    : !hasRecordingContext
      ? 'select'
      : mdvr && (playback.status === 'starting' || playback.status === 'waiting')
        ? 'waiting'
        : mdvr && playback.status === 'error'
          ? 'error'
          : mdvr && playback.status === 'ready'
            ? null
            : 'none';

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-hidden p-1.5 md:p-2">
      {!hasMdvr && (
        <Alert
          variant="warning"
          title={t('video.playback.unavailableTitle', { defaultValue: 'Playback backend pending' })}
        >
          {t('video.playback.unavailableBody', {
            defaultValue:
              'The media service does not expose recording playback yet — the transport below is ready, and the stream area will light up when the endpoint ships. No simulated footage is ever rendered.',
          })}
        </Alert>
      )}

      <div className="flex shrink-0 flex-wrap items-center gap-1.5">
        <select
          value={channelId}
          onChange={(e) => setChannelId(e.target.value)}
          aria-label={t('video.playback.channel', { defaultValue: 'Camera / channel' })}
          className="h-7 max-w-48 min-w-36 cursor-pointer rounded-md border border-gray-300 bg-white px-2 text-xs text-gray-700 focus:border-brand-500 focus:outline-none dark:border-white/10 dark:bg-graydark-300 dark:text-graydark-800"
        >
          <option value="">
            {t('video.playback.channel', { defaultValue: 'Camera / channel' })}
          </option>
          {available.map((c) => (
            <option key={c.id} value={c.id}>
              {c.sourceLabel && c.sourceLabel !== c.label
                ? `${c.sourceLabel} · ${c.label}`
                : c.label}
            </option>
          ))}
        </select>
        <Input
          type="datetime-local"
          aria-label={t('notifications.center.filters.from', { defaultValue: 'From' })}
          value={fromInput}
          onChange={(e) => setFromInput(e.target.value)}
          wrapperClassName="w-[12.5rem]"
          className="!h-7 px-2 text-xs"
        />
        <Input
          type="datetime-local"
          aria-label={t('notifications.center.filters.to', { defaultValue: 'To' })}
          value={toInput}
          onChange={(e) => setToInput(e.target.value)}
          wrapperClassName="w-[12.5rem]"
          className="!h-7 px-2 text-xs"
        />
        {mdvr && (
          <button
            type="button"
            onClick={search}
            disabled={!rangeValid || !channel || busy}
            data-testid="playback-search"
            title={t('video.playback.mdvrHint')}
            className="h-7 cursor-pointer rounded-md border border-brand-500 px-2.5 text-xs font-semibold text-brand-600 transition-colors hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-50 dark:text-brand-400 dark:hover:bg-brand-500/10"
          >
            {t('video.playback.search', { defaultValue: 'Search' })}
          </button>
        )}
        <button
          type="button"
          onClick={load}
          disabled={!rangeValid || !channel || busy}
          data-testid="playback-load"
          className="h-7 cursor-pointer rounded-md bg-brand-500 px-2.5 text-xs font-semibold text-white transition-colors hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t('video.playback.load', { defaultValue: 'Load' })}
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-1.5 md:flex-row">
        {mdvr && (
          <aside
            data-testid="playback-resource-list"
            className="flex min-h-40 w-full shrink-0 flex-col overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-white/10 dark:bg-graydark-300 md:h-auto md:min-h-0 md:w-64 xl:w-72"
          >
            <div className="border-b border-gray-100 px-2 py-1 text-xs font-semibold text-gray-800 dark:border-white/10 dark:text-graydark-800">
              {t('video.playback.listTitle', { defaultValue: 'Recordings' })}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {resourceStatus === 'listing' && (
                <div className="flex items-center gap-2 px-1 py-3 text-sm text-gray-500">
                  <Spinner size="sm" label={t('video.playback.listing')} />
                  {t('video.playback.listing')}
                </div>
              )}
              {resourceStatus === 'error' && (
                <p className="px-1 py-2 text-sm text-warning-600">
                  {resourceError === 'device-no-reply'
                    ? t('video.playback.deviceNoReply')
                    : t('video.playback.listError', { message: resourceError ?? '' })}
                </p>
              )}
              {resourceStatus === 'ready' && videos.length === 0 && photos.length === 0 && (
                <p className="px-1 py-2 text-sm text-gray-500">{t('video.playback.empty')}</p>
              )}
              {resourceStatus === 'idle' && (
                <p className="px-1 py-2 text-sm text-gray-500">{t('video.playback.selectFirst')}</p>
              )}
              <ResourceGroup
                title={t('video.playback.videos', { defaultValue: 'Videos' })}
                icon={<Film size={14} aria-hidden />}
                items={videos}
                kind="video"
                onPlay={playResource}
                playLabel={t('video.playback.playClip', { defaultValue: 'Play this clip' })}
              />
              <ResourceGroup
                title={t('video.playback.photos', { defaultValue: 'Photos' })}
                icon={<Image size={14} aria-hidden />}
                items={photos}
                kind="photo"
                onPlay={viewPhoto}
                playLabel={t('video.playback.viewPhoto', { defaultValue: 'View this photo' })}
                hint={t('video.playback.photoHint')}
              />
            </div>
          </aside>
        )}

        <div
          ref={stageRef}
          data-testid="playback-video-area"
          className="relative flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-gray-200 bg-black dark:border-white/10"
        >
          <div className="relative min-h-0 flex-1">
            {mdvr && playback.hlsUrl && !viewingPhoto && (
              <HLSLivePlayer
                key={playback.playerKey}
                ref={videoRef}
                hlsUrl={playback.hlsUrl}
                muted={muted}
                onReady={playback.onPlayerReady}
                objectFit="contain"
                lowLatencyMode={false}
              />
            )}
            {photo.status === 'ready' && (
              <div
                data-testid="playback-photo-stage"
                className="absolute inset-0 flex items-center justify-center bg-black"
              >
                <img
                  data-testid="playback-photo-preview"
                  src={photo.url}
                  alt={photo.filename}
                  className="max-h-full max-w-full object-contain"
                />
                <span className="absolute bottom-2 start-2 max-w-[90%] truncate rounded bg-black/60 px-2 py-0.5 text-xs text-gray-200">
                  {photo.filename}
                </span>
              </div>
            )}

            {overlay === 'select' && (
              <div className="absolute inset-0 flex items-center justify-center">
                <p className="text-sm text-gray-500">
                  {t('video.playback.selectFirst', {
                    defaultValue: 'Select a camera and time window, then Search or Load',
                  })}
                </p>
              </div>
            )}
            {overlay === 'photo-waiting' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/55">
                <Spinner size="lg" label={t('video.playback.photoWaiting')} />
                <p className="text-sm text-gray-300">{t('video.playback.photoWaiting')}</p>
              </div>
            )}
            {overlay === 'photo-error' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/70 px-6 text-center">
                <AlertTriangle size={28} aria-hidden className="text-warning-500" />
                <p className="text-sm text-gray-200">
                  {photo.status === 'error' && photo.message === 'no-filename'
                    ? t('video.playback.photoMissing')
                    : t('video.playback.photoFailed', {
                        message: photo.status === 'error' ? photo.message : '',
                      })}
                </p>
              </div>
            )}
            {overlay === 'waiting' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/55">
                <Spinner size="lg" label={t('video.playback.waiting')} />
                <p className="text-sm text-gray-300">{t('video.playback.waiting')}</p>
              </div>
            )}
            {overlay === 'error' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/70 px-6 text-center">
                <AlertTriangle size={28} aria-hidden className="text-warning-500" />
                <p className="text-sm text-gray-200">
                  {playback.error === 'timeout'
                    ? t('video.playback.timeout')
                    : t('video.playback.failed', { message: playback.error ?? '' })}
                </p>
              </div>
            )}
            {overlay === 'none' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-gray-500">
                <AlertTriangle size={28} aria-hidden className="text-warning-500" />
                <p className="text-sm">
                  {t('video.playback.noRecording', {
                    defaultValue: 'No recording available for this window yet',
                  })}
                </p>
              </div>
            )}

            {hasRecordingContext && !viewingPhoto && (
              <span className="absolute top-2 start-2 inline-flex items-center gap-1.5 rounded-full bg-black/60 px-2 py-0.5 text-xs text-gray-200">
                {channel?.label}
                {playing && playback.status === 'ready' && <Badge color="danger">▶</Badge>}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5 bg-black/80 px-2 py-1.5">
            <button
              type="button"
              onClick={() => (playing ? setPlaying(false) : cursorMs !== null && setPlaying(true))}
              disabled={cursorMs === null}
              aria-label={playing ? t('map.playback.pause') : t('map.playback.play')}
              data-testid={playing ? 'video-playback-pause' : 'video-playback-play'}
              className="inline-flex size-8 cursor-pointer items-center justify-center rounded-md bg-brand-500 text-white transition-colors hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {playing ? <Pause size={15} /> : <Play size={15} />}
            </button>
            <button
              type="button"
              onClick={stopAll}
              disabled={cursorMs === null}
              aria-label={t('map.playback.stop')}
              data-testid="video-playback-stop"
              className="inline-flex size-8 cursor-pointer items-center justify-center rounded-md border border-white/15 text-gray-200 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Square size={13} />
            </button>
            <button
              type="button"
              onClick={() => seek(from)}
              disabled={cursorMs === null}
              aria-label={t('video.playback.rewind', { defaultValue: 'Back to start' })}
              className="inline-flex size-8 cursor-pointer items-center justify-center rounded-md border border-white/15 text-gray-200 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RotateCcw size={13} />
            </button>

            <input
              type="range"
              min={from}
              max={to}
              value={cursorMs ?? from}
              onChange={(e) => seek(Number(e.target.value))}
              disabled={cursorMs === null}
              aria-label={t('video.playback.timeline', { defaultValue: 'Playback timeline' })}
              data-testid="video-playback-timeline"
              className="h-1.5 min-w-32 flex-1 cursor-pointer appearance-none rounded-full bg-white/15 accent-brand-500 disabled:opacity-50"
            />

            <select
              value={speed}
              onChange={(e) => setSpeed(Number(e.target.value) as ClipPlaybackSpeed)}
              disabled={cursorMs === null}
              aria-label={t('video.playback.speed', { defaultValue: 'Playback speed' })}
              data-testid="video-playback-speed"
              className="h-8 cursor-pointer rounded-md border border-white/15 bg-black/40 px-1.5 text-[11px] font-semibold text-gray-200 focus:border-brand-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
            >
              {CLIP_PLAYBACK_SPEEDS.map((s) => (
                <option key={s} value={s}>
                  {s}×
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={takeSnapshot}
              disabled={!canSnapshot || snapshot.isPending}
              aria-label={t('video.tile.snapshot')}
              data-testid="video-playback-snapshot"
              className="inline-flex size-8 cursor-pointer items-center justify-center rounded-md border border-white/15 text-gray-200 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ImageDown size={14} />
            </button>
            <button
              type="button"
              onClick={() => setMuted((v) => !v)}
              aria-label={muted ? t('video.tile.unmute') : t('video.tile.mute')}
              className="inline-flex size-8 cursor-pointer items-center justify-center rounded-md border border-white/15 text-gray-200 transition-colors hover:bg-white/10"
            >
              {muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
            </button>
            <button
              type="button"
              onClick={() => stageRef.current && void toggleFullscreen(stageRef.current)}
              aria-label={t('video.tile.fullscreen')}
              className="inline-flex size-8 cursor-pointer items-center justify-center rounded-md border border-white/15 text-gray-200 transition-colors hover:bg-white/10"
            >
              <Maximize2 size={14} />
            </button>

            <span
              className="flex items-center gap-1.5 text-[11px] tabular-nums text-gray-400"
              title={t('video.playback.window', {
                defaultValue: '{{min}} min window',
                min: Math.max(1, Math.round(windowMs / 60_000)),
              })}
            >
              {playing && (
                <Badge color="brand">
                  {t('video.playback.playing', { defaultValue: 'Playing' })}
                </Badge>
              )}
              <span
                data-testid="video-playback-current"
                title={cursorMs !== null ? fmtFull(cursorMs) : undefined}
              >
                {cursorMs !== null ? fmtTime(cursorMs) : '--:--:--'}
              </span>
              / {fmtTime(to)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function ResourceGroup({
  title,
  icon,
  items,
  kind,
  onPlay,
  playLabel,
  hint,
}: {
  title: string;
  icon: ReactNode;
  items: MdvrResource[];
  kind: 'video' | 'photo';
  onPlay: (r: MdvrResource) => void;
  playLabel: string;
  hint?: string;
}) {
  if (items.length === 0) return null;
  return (
    <div className="mb-2">
      <div className="mb-1 flex items-center gap-1.5 px-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
        {icon}
        {title}
      </div>
      {hint && <p className="mb-1 px-1 text-xs text-gray-500">{hint}</p>}
      <ul className="flex flex-col gap-0.5">
        {items.map((r, i) => {
          const win = clipWindow(r);
          const size = fmtBytes(r.fileLen);
          const photoName = kind === 'photo' ? photoFilenameOf(r) : '';
          return (
            <li key={`${kind}-${r.startTime}-${r.endTime}-${r.fileLen}-${photoName}-${i}`}>
              <button
                type="button"
                onClick={() => onPlay(r)}
                data-testid={`playback-clip-${kind}-${i}`}
                aria-label={playLabel}
                className="flex w-full cursor-pointer items-start gap-2 rounded-lg px-2.5 py-2.5 text-start text-sm text-gray-800 transition-colors hover:bg-gray-50 dark:text-graydark-800 dark:hover:bg-white/5"
              >
                <span className="mt-0.5 text-gray-400">{icon}</span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">
                    {photoName || (win ? fmtFull(win.fromMs) : r.startTime)}
                  </span>
                  <span className="text-xs text-gray-500">
                    {win ? `${fmtTime(win.fromMs)} – ${fmtTime(win.toMs)}` : r.endTime}
                    {size ? ` · ${size}` : ''}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
