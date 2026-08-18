/**
 * PlaybackPanel — recorded-video playback shell (Phase 7).
 *
 * Implements the operator surface — camera/channel selection, date/time
 * range, timeline scrubber, and the play/pause/seek transport with live
 * playback state — over an HONEST data boundary: media-service exposes
 * streams/channels only (no recording/playback endpoint yet), so the video
 * area explicitly reports "playback backend not available" instead of
 * rendering a fabricated stream (same contract as `useSaveWall`).
 *
 * The transport state machine is real and local: play advances the playhead
 * across the selected window, pause freezes it, the timeline seeks. When the
 * backend ships `GET /channels/:id/recordings`, only `loadRecording` changes.
 */
import { AlertTriangle, Pause, Play, RotateCcw, Square } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Alert, Badge, Card } from '@/components/tailwind-ui';
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

interface PlaybackPanelProps {
  channels: CameraChannel[];
}

export function PlaybackPanel({ channels }: PlaybackPanelProps) {
  const { t } = useTranslation();
  const available = useMemo(() => channels.filter((c) => c.online && c.consentGiven), [channels]);

  const [channelId, setChannelId] = useState('');
  const [fromInput, setFromInput] = useState(() => toDateInput(Date.now() - 3600_000));
  const [toInput, setToInput] = useState(() => toDateInput(Date.now()));

  const [playing, setPlaying] = useState(false);
  const [cursorMs, setCursorMs] = useState<number | null>(null);
  const lastTickRef = useRef(0);

  const from = new Date(fromInput).getTime();
  const to = new Date(toInput).getTime();
  const rangeValid = Number.isFinite(from) && Number.isFinite(to) && to > from;
  const windowMs = rangeValid ? to - from : 0;

  // Playhead advance (250ms interval — smooth enough for a timeline cursor,
  // stack-safe under synchronous rAF stubs in tests, pauses nothing else).
  // biome-ignore lint/correctness/useExhaustiveDependencies: cursorMs is read only to gate the interval start; advancing uses the functional setState so the effect must not re-arm per tick
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

  const load = () => {
    if (!rangeValid) return;
    setPlaying(false);
    setCursorMs(from);
  };

  const seek = (value: number) => {
    setCursorMs(value);
  };

  const channel = available.find((c) => c.id === channelId) ?? null;
  const hasRecordingContext = channel !== null && cursorMs !== null;

  return (
    <div className="fv-scroll min-h-0 flex-1 overflow-y-auto p-4">
      <div className="mx-auto flex max-w-4xl flex-col gap-4">
        {/* Honest capability notice */}
        <Alert
          variant="warning"
          title={t('video.playback.unavailableTitle', { defaultValue: 'Playback backend pending' })}
        >
          {t('video.playback.unavailableBody', {
            defaultValue:
              'The media service does not expose recording playback yet — the transport below is ready, and the stream area will light up when the endpoint ships. No simulated footage is ever rendered.',
          })}
        </Alert>

        {/* Selector row: channel + time window */}
        <Card className="flex flex-wrap items-end gap-3 p-4">
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
                  {c.label}
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
          <button
            type="button"
            onClick={load}
            disabled={!rangeValid}
            data-testid="playback-load"
            className="h-9 cursor-pointer rounded-lg bg-brand-500 px-4 text-sm font-semibold text-white transition-colors hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t('video.playback.load', { defaultValue: 'Load' })}
          </button>
        </Card>

        {/* Video area — honest unavailable state until the backend ships */}
        <div
          data-testid="playback-video-area"
          className="relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-xl border border-gray-200 bg-black dark:border-white/10"
        >
          {hasRecordingContext ? (
            <div className="flex flex-col items-center gap-2 text-gray-500">
              <AlertTriangle size={28} aria-hidden className="text-warning-500" />
              <p className="text-sm">
                {t('video.playback.noRecording', {
                  defaultValue: 'No recording available for this window yet',
                })}
              </p>
            </div>
          ) : (
            <p className="text-sm text-gray-500">
              {t('video.playback.selectFirst', {
                defaultValue: 'Select a camera and time window, then Load',
              })}
            </p>
          )}
          {hasRecordingContext && (
            <span className="absolute top-2 start-2 inline-flex items-center gap-1.5 rounded-full bg-black/60 px-2 py-0.5 text-xs text-gray-200">
              {channel?.label}
              {playing && <Badge color="danger">▶</Badge>}
            </span>
          )}
        </div>

        {/* Transport */}
        <Card className="flex flex-col gap-2 p-4">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => (playing ? setPlaying(false) : cursorMs !== null && setPlaying(true))}
              disabled={cursorMs === null}
              aria-label={playing ? t('map.playback.pause') : t('map.playback.play')}
              data-testid={playing ? 'video-playback-pause' : 'video-playback-play'}
              className="inline-flex size-9 cursor-pointer items-center justify-center rounded-lg bg-brand-500 text-white transition-colors hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {playing ? <Pause size={17} /> : <Play size={17} />}
            </button>
            <button
              type="button"
              onClick={() => {
                setPlaying(false);
                setCursorMs(null);
              }}
              disabled={cursorMs === null}
              aria-label={t('map.playback.stop')}
              data-testid="video-playback-stop"
              className="inline-flex size-9 cursor-pointer items-center justify-center rounded-lg border border-gray-300 text-gray-600 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:text-graydark-700 dark:hover:bg-white/5"
            >
              <Square size={15} />
            </button>
            <button
              type="button"
              onClick={() => seek(from)}
              disabled={cursorMs === null}
              aria-label={t('video.playback.rewind', { defaultValue: 'Back to start' })}
              className="inline-flex size-9 cursor-pointer items-center justify-center rounded-lg border border-gray-300 text-gray-600 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:text-graydark-700 dark:hover:bg-white/5"
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
              className="h-1.5 min-w-32 flex-1 cursor-pointer appearance-none rounded-full bg-gray-200 accent-brand-500 disabled:opacity-50 dark:bg-white/10"
            />

            <span className="flex items-center gap-2 text-xs tabular-nums text-gray-500 dark:text-graydark-600">
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
          <div className="flex justify-between text-xs tabular-nums text-gray-400 dark:text-graydark-600">
            <span>{fmtTime(from)}</span>
            <span>
              {t('video.playback.window', {
                defaultValue: '{{min}} min window',
                min: Math.max(1, Math.round(windowMs / 60_000)),
              })}
            </span>
          </div>
        </Card>
      </div>
    </div>
  );
}
