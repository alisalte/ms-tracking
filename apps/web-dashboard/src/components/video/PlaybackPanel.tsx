/**
 * PlaybackPanel — recorded video from the MDVR SD card (AB8 list → AB4 HLS).
 *
 * Operator picks a camera + date window. Search asks the device (AB8) for
 * videos and photos in that window; clicking a row plays that clip (AB4).
 * Load still plays the whole window. Mock / non-MDVR channels stay honest:
 * no fabricated stream.
 */
import {
  AlertTriangle,
  Film,
  Image,
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

import { type MdvrResource, fromMdvrBcdTime } from '@/api/video.api';
import { Alert, Badge, Spinner } from '@/components/tailwind-ui';
import { HLSLivePlayer } from '@/components/video/HLSLivePlayer';
import { useMdvrPlayback } from '@/components/video/useMdvrPlayback';
import { useMdvrResources } from '@/components/video/useMdvrResources';
import { isMdvrChannel } from '@/components/video/useStreamSession';
import { toggleFullscreen } from '@/lib/video-stream';
import type { CameraChannel } from '@/types/video.types';

/** Playback playhead advance rate (ms of recording per real second), 1×. */
const PLAYBACK_MS_PER_SECOND = 1000;

function fmtTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}
function fmtFull(ms: number): string {
  return new Date(ms).toLocaleString();
}
function toDateInput(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
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

interface PlaybackPanelProps {
  channels: CameraChannel[];
}

export function PlaybackPanel({ channels }: PlaybackPanelProps) {
  const { t } = useTranslation();
  const available = useMemo(() => channels.filter((c) => c.online && c.consentGiven), [channels]);
  const hasMdvr = useMemo(() => channels.some((c) => isMdvrChannel(c)), [channels]);
  const playback = useMdvrPlayback();
  const resources = useMdvrResources();

  const [channelId, setChannelId] = useState('');
  const [fromInput, setFromInput] = useState(() => toDateInput(Date.now() - 2 * 3600_000));
  const [toInput, setToInput] = useState(() => toDateInput(Date.now()));

  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const [cursorMs, setCursorMs] = useState<number | null>(null);
  const lastTickRef = useRef(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);

  const from = new Date(fromInput).getTime();
  const to = new Date(toInput).getTime();
  const rangeValid = Number.isFinite(from) && Number.isFinite(to) && to > from;
  const windowMs = rangeValid ? to - from : 0;

  const channel = available.find((c) => c.id === channelId) ?? null;
  const mdvr = isMdvrChannel(channel);
  const hasRecordingContext = channel !== null && cursorMs !== null;
  const busy = playback.status === 'starting' || resources.status === 'listing';

  // biome-ignore lint/correctness/useExhaustiveDependencies: cursorMs gates start; ticks use functional setState
  useEffect(() => {
    if (!playing || cursorMs === null) return;
    lastTickRef.current = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now();
      const dt = now - lastTickRef.current;
      lastTickRef.current = now;
      setCursorMs((prev) => {
        if (prev === null) return prev;
        const next = prev + dt * PLAYBACK_MS_PER_SECOND;
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
  }, [playing, to]);

  useEffect(() => {
    if (playback.status === 'ready') setPlaying(true);
  }, [playback.status]);

  useEffect(() => {
    if (playback.status !== 'ready') return;
    const video = videoRef.current;
    if (!video) return;
    if (playing) void video.play()?.catch(() => undefined);
    else video.pause();
  }, [playing, playback.status]);

  const beginPlayback = (ch: CameraChannel, fromMs: number, toMs: number, avType = '3') => {
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
    void resources.search(channel, from, to);
  };

  const playResource = (r: MdvrResource) => {
    if (!channel) return;
    const win = clipWindow(r);
    if (!win) return;
    beginPlayback(channel, win.fromMs, win.toMs, String(r.avType || 3));
  };

  const seek = (value: number) => {
    setCursorMs(value);
    if (mdvr && playback.status === 'ready') {
      void playback.seekDevice(value);
    }
  };

  const stopAll = () => {
    setPlaying(false);
    setCursorMs(null);
    void playback.stop();
  };

  const overlay = !hasRecordingContext
    ? 'select'
    : mdvr && (playback.status === 'starting' || playback.status === 'waiting')
      ? 'waiting'
      : mdvr && playback.status === 'error'
        ? 'error'
        : mdvr && playback.status === 'ready'
          ? null
          : 'none';

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
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

      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-gray-200 bg-white p-3 dark:border-white/10 dark:bg-graydark-300">
        <label className="flex min-w-56 flex-1 flex-col gap-1.5">
          <span className="text-sm font-medium text-gray-700 dark:text-graydark-800">
            {t('video.playback.channel', { defaultValue: 'Camera / channel' })}
          </span>
          <select
            value={channelId}
            onChange={(e) => setChannelId(e.target.value)}
            aria-label={t('video.playback.channel', { defaultValue: 'Camera / channel' })}
            className="h-9 cursor-pointer rounded-lg border border-gray-300 bg-white px-2.5 text-sm text-gray-700 focus:border-brand-500 focus:outline-none dark:border-white/10 dark:bg-graydark-300 dark:text-graydark-800"
          >
            <option value="">{t('common.all', { defaultValue: 'All' })}…</option>
            {available.map((c) => (
              <option key={c.id} value={c.id}>
                {c.sourceLabel && c.sourceLabel !== c.label
                  ? `${c.sourceLabel} · ${c.label}`
                  : c.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-gray-700 dark:text-graydark-800">
            {t('notifications.center.filters.from', { defaultValue: 'From' })}
          </span>
          <input
            type="datetime-local"
            value={fromInput}
            onChange={(e) => setFromInput(e.target.value)}
            aria-label={t('notifications.center.filters.from', { defaultValue: 'From' })}
            className="h-9 rounded-lg border border-gray-300 bg-white px-2.5 text-sm text-gray-700 focus:border-brand-500 focus:outline-none dark:border-white/10 dark:bg-graydark-300 dark:text-graydark-800"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-gray-700 dark:text-graydark-800">
            {t('notifications.center.filters.to', { defaultValue: 'To' })}
          </span>
          <input
            type="datetime-local"
            value={toInput}
            onChange={(e) => setToInput(e.target.value)}
            aria-label={t('notifications.center.filters.to', { defaultValue: 'To' })}
            className="h-9 rounded-lg border border-gray-300 bg-white px-2.5 text-sm text-gray-700 focus:border-brand-500 focus:outline-none dark:border-white/10 dark:bg-graydark-300 dark:text-graydark-800"
          />
        </label>
        {mdvr && (
          <button
            type="button"
            onClick={search}
            disabled={!rangeValid || !channel || busy}
            data-testid="playback-search"
            className="h-9 cursor-pointer rounded-lg border border-brand-500 px-4 text-sm font-semibold text-brand-600 transition-colors hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-50 dark:text-brand-400 dark:hover:bg-brand-500/10"
          >
            {t('video.playback.search', { defaultValue: 'Search' })}
          </button>
        )}
        <button
          type="button"
          onClick={load}
          disabled={!rangeValid || !channel || busy}
          data-testid="playback-load"
          className="h-9 cursor-pointer rounded-lg bg-brand-500 px-4 text-sm font-semibold text-white transition-colors hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t('video.playback.load', { defaultValue: 'Load' })}
        </button>
      </div>

      {hasMdvr && (
        <p className="px-1 text-xs text-gray-500 dark:text-graydark-600">
          {t('video.playback.mdvrHint')}
        </p>
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row">
        {mdvr && (
          <aside
            data-testid="playback-resource-list"
            className="flex max-h-64 min-h-0 w-full flex-col overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-white/10 dark:bg-graydark-300 lg:max-h-none lg:w-80"
          >
            <div className="border-b border-gray-100 px-3 py-2 text-sm font-semibold text-gray-800 dark:border-white/10 dark:text-graydark-800">
              {t('video.playback.listTitle', { defaultValue: 'Recordings' })}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {resources.status === 'listing' && (
                <div className="flex items-center gap-2 px-1 py-3 text-sm text-gray-500">
                  <Spinner size="sm" label={t('video.playback.listing')} />
                  {t('video.playback.listing')}
                </div>
              )}
              {resources.status === 'error' && (
                <p className="px-1 py-2 text-sm text-warning-600">
                  {t('video.playback.listError', { message: resources.error ?? '' })}
                </p>
              )}
              {resources.status === 'ready' &&
                resources.videos.length === 0 &&
                resources.photos.length === 0 && (
                  <p className="px-1 py-2 text-sm text-gray-500">{t('video.playback.empty')}</p>
                )}
              {resources.status === 'idle' && (
                <p className="px-1 py-2 text-sm text-gray-500">{t('video.playback.selectFirst')}</p>
              )}
              <ResourceGroup
                title={t('video.playback.videos', { defaultValue: 'Videos' })}
                icon={<Film size={14} aria-hidden />}
                items={resources.videos}
                kind="video"
                onPlay={playResource}
                playLabel={t('video.playback.playClip', { defaultValue: 'Play this clip' })}
              />
              <ResourceGroup
                title={t('video.playback.photos', { defaultValue: 'Photos' })}
                icon={<Image size={14} aria-hidden />}
                items={resources.photos}
                kind="photo"
                onPlay={playResource}
                playLabel={t('video.playback.playClip', { defaultValue: 'Play this clip' })}
              />
            </div>
          </aside>
        )}

        <div
          ref={stageRef}
          data-testid="playback-video-area"
          className="relative flex min-h-0 w-full flex-1 flex-col overflow-hidden rounded-xl border border-gray-200 bg-black dark:border-white/10"
        >
          <div className="relative min-h-[240px] flex-1">
            {mdvr && playback.hlsUrl && (
              <HLSLivePlayer
                ref={videoRef}
                hlsUrl={playback.hlsUrl}
                muted={muted}
                onReady={playback.onPlayerReady}
                objectFit="contain"
              />
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

            {hasRecordingContext && (
              <span className="absolute top-2 start-2 inline-flex items-center gap-1.5 rounded-full bg-black/60 px-2 py-0.5 text-xs text-gray-200">
                {channel?.label}
                {playing && playback.status === 'ready' && <Badge color="danger">▶</Badge>}
              </span>
            )}
          </div>

          <div className="flex flex-col gap-2 bg-black/80 px-3 py-2.5">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  playing ? setPlaying(false) : cursorMs !== null && setPlaying(true)
                }
                disabled={cursorMs === null}
                aria-label={playing ? t('map.playback.pause') : t('map.playback.play')}
                data-testid={playing ? 'video-playback-pause' : 'video-playback-play'}
                className="inline-flex size-9 cursor-pointer items-center justify-center rounded-lg bg-brand-500 text-white transition-colors hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {playing ? <Pause size={17} /> : <Play size={17} />}
              </button>
              <button
                type="button"
                onClick={stopAll}
                disabled={cursorMs === null}
                aria-label={t('map.playback.stop')}
                data-testid="video-playback-stop"
                className="inline-flex size-9 cursor-pointer items-center justify-center rounded-lg border border-white/15 text-gray-200 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Square size={15} />
              </button>
              <button
                type="button"
                onClick={() => seek(from)}
                disabled={cursorMs === null}
                aria-label={t('video.playback.rewind', { defaultValue: 'Back to start' })}
                className="inline-flex size-9 cursor-pointer items-center justify-center rounded-lg border border-white/15 text-gray-200 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <RotateCcw size={15} />
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

              <button
                type="button"
                onClick={() => setMuted((v) => !v)}
                aria-label={muted ? t('video.tile.unmute') : t('video.tile.mute')}
                className="inline-flex size-9 cursor-pointer items-center justify-center rounded-lg border border-white/15 text-gray-200 transition-colors hover:bg-white/10"
              >
                {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
              </button>
              <button
                type="button"
                onClick={() => stageRef.current && void toggleFullscreen(stageRef.current)}
                aria-label={t('video.tile.fullscreen')}
                className="inline-flex size-9 cursor-pointer items-center justify-center rounded-lg border border-white/15 text-gray-200 transition-colors hover:bg-white/10"
              >
                <Maximize2 size={16} />
              </button>

              <span className="flex items-center gap-2 text-xs tabular-nums text-gray-400">
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
            <div className="flex justify-between text-xs tabular-nums text-gray-500">
              <span>{fmtTime(from)}</span>
              <span>
                {t('video.playback.window', {
                  defaultValue: '{{min}} min window',
                  min: Math.max(1, Math.round(windowMs / 60_000)),
                })}
              </span>
            </div>
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
}: {
  title: string;
  icon: ReactNode;
  items: MdvrResource[];
  kind: 'video' | 'photo';
  onPlay: (r: MdvrResource) => void;
  playLabel: string;
}) {
  if (items.length === 0) return null;
  return (
    <div className="mb-2">
      <div className="mb-1 flex items-center gap-1.5 px-1 text-xs font-semibold uppercase tracking-wide text-gray-500">
        {icon}
        {title}
      </div>
      <ul className="flex flex-col gap-0.5">
        {items.map((r, i) => {
          const win = clipWindow(r);
          const size = fmtBytes(r.fileLen);
          return (
            <li key={`${kind}-${r.startTime}-${r.endTime}-${r.fileLen}-${i}`}>
              <button
                type="button"
                onClick={() => onPlay(r)}
                data-testid={`playback-clip-${kind}-${i}`}
                aria-label={playLabel}
                className="flex w-full cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 text-start text-sm text-gray-800 transition-colors hover:bg-gray-50 dark:text-graydark-800 dark:hover:bg-white/5"
              >
                <span className="mt-0.5 text-gray-400">{icon}</span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">{win ? fmtFull(win.fromMs) : r.startTime}</span>
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
