/**
 * VideoTile — the TailAdmin atomic unit of the Video Wall (Phase 7 port;
 * 10 §2.2, UI_UX §0.5).
 *
 * Wraps a `LiveVideoPlayer` with the documented overlays (latency badge, REC
 * dot, signal indicator, channel label, cabin-cam badge, alert border) and the
 * control bar (snapshot, fullscreen, mute, quality menu, spotlight, remove).
 * Drives a `useStreamSession` for its channel and forwards the `<video>` ref so
 * snapshot/fullscreen operate on real pixels. Every control is a real button
 * with an aria-label (keyboard-friendly).
 *
 * States:
 * - empty slot → placeholder prompt to add a channel.
 * - offline / no-consent → disabled overlay (INV-MED02).
 * - connecting → skeleton + spinner.
 * - active → live video + overlays + controls.
 * - queued (wall overflow) → placeholder frame + "queued" badge.
 *
 * Performance contract: non-live (queued) tiles pass `null` to the session
 * hook, tearing the stream down — no hidden background streams.
 */
import {
  Camera,
  ImageDown,
  Maximize2,
  Pin,
  Settings2,
  Sparkles,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useSnapshot } from '@/api/video.api';
import { Dropdown, DropdownItem, Spinner, Tooltip } from '@/components/tailwind-ui';
import { LiveVideoPlayer } from '@/components/video/LiveVideoPlayer';
import { useStreamSession } from '@/components/video/useStreamSession';
import { toggleFullscreen } from '@/lib/video-stream';
import type { CameraChannel, StreamQuality } from '@/types/video.types';

/** Quality menu options (10 §2.3 table). */
const QUALITIES: StreamQuality[] = ['auto', 'high', 'medium', 'low', 'audio-only'];

/** Signal indicator dot color. */
function signalColor(signal: 'good' | 'fair' | 'poor' | undefined): string {
  if (signal === 'good') return '#16A34A';
  if (signal === 'fair') return '#F59E0B';
  if (signal === 'poor') return '#DC2626';
  return '#64748B';
}

interface VideoTileProps {
  /** The channel bound to this slot, or null for an empty slot. */
  channel: CameraChannel | null;
  /** Whether this tile is live (within the wall's maxLive cap) vs queued. */
  live: boolean;
  /** Pinned (spotlight) state — controls the pin button. */
  pinned?: boolean;
  /** Active alert on this tile (red border + chime context). */
  alert?: boolean;
  /** Compact rendering for thumbnail/spotlight-thumb mode. */
  compact?: boolean;
  /** Pin (spotlight) toggle handler. */
  onTogglePin?: () => void;
  /** Remove the channel from this slot. */
  onRemove?: () => void;
  /** Promote this queued tile to live immediately. */
  onPromote?: () => void;
}

export function VideoTile({
  channel,
  live,
  pinned = false,
  alert = false,
  compact = false,
  onTogglePin,
  onRemove,
  onPromote,
}: VideoTileProps) {
  const { t } = useTranslation();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const snapshot = useSnapshot();

  const [muted, setMuted] = useState(true);
  const [quality, setQuality] = useState<StreamQuality>('auto');

  // The session hook stays mounted; for non-live/queued tiles we pass null so
  // it tears down and frees the canvas resource.
  const activeChannel = live && channel ? channel : null;
  const {
    session,
    stream,
    streamKind,
    setQuality: changeQuality,
  } = useStreamSession(activeChannel, quality);

  // Empty slot.
  if (!channel) {
    return (
      <div className="relative flex h-full min-h-0 w-full items-center justify-center rounded-lg border-2 border-dashed border-gray-300 bg-gray-100 dark:border-white/10 dark:bg-white/5">
        <span className="text-xs text-gray-400 dark:text-graydark-600">
          {t('video.tile.empty')}
        </span>
      </div>
    );
  }

  // Disabled channel (offline or no consent).
  if (!channel.online || !channel.consentGiven) {
    return (
      <TileFrame label={channel.label} alert={false}>
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[#0b1220]">
          <Camera size={compact ? 16 : 28} color="#475569" aria-hidden />
          <p className="px-3 text-center text-xs text-gray-500">
            {t(channel.consentGiven ? 'video.tile.offline' : 'video.tile.noConsent')}
          </p>
        </div>
        <TileLabel label={channel.label} compact={compact} />
      </TileFrame>
    );
  }

  // Queued (overflow) tile — placeholder frame, click to promote.
  if (!live) {
    return (
      <TileFrame label={channel.label} alert={false}>
        <button
          type="button"
          onClick={onPromote}
          className="absolute inset-0 flex cursor-pointer flex-col items-center justify-center gap-2 border-none bg-[#0b1220] transition-colors hover:bg-[#111c30]"
        >
          <span className="inline-flex h-5 items-center rounded-full border border-warning-400 px-2 text-[0.65rem] font-semibold text-warning-400">
            {t('video.tile.queued')}
          </span>
          {!compact && (
            <span className="text-xs text-gray-500">{t('video.tile.clickToPromote')}</span>
          )}
        </button>
        <TileLabel label={channel.label} compact={compact} />
      </TileFrame>
    );
  }

  // Live tile.
  const connecting = !stream || session?.state === 'connecting';
  return (
    <TileFrame label={channel.label} alert={alert}>
      <div ref={containerRef} className="absolute inset-0 bg-black">
        <LiveVideoPlayer ref={videoRef} stream={stream} muted={muted} active />

        {/* Connecting overlay */}
        {connecting && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50">
            <Spinner size={compact ? 'sm' : 'lg'} label={t('common.loading')} />
          </div>
        )}

        {/* Top-left overlays: latency + stream-kind + REC + signal */}
        {!compact && (
          <div className="absolute top-1.5 start-1.5 flex items-center gap-1.5">
            {session?.state === 'active' && (
              <span className="inline-flex h-[18px] items-center rounded-full bg-black/60 px-1.5 text-[0.6rem] tabular-nums text-gray-200">
                {session.latencyMs}ms
              </span>
            )}
            {/* Honest stream-kind badge: never present a stub as real. */}
            {streamKind !== 'real' && (
              <span
                className={`inline-flex h-[18px] items-center rounded-full px-1.5 text-[0.55rem] font-bold text-white ${
                  streamKind === 'stub' ? 'bg-warning-500/85' : 'bg-danger-600/85'
                }`}
              >
                {streamKind === 'stub' ? 'DEMO' : 'OFFLINE'}
              </span>
            )}
            {channel.recordingActive && (
              <span className="inline-flex h-[18px] items-center gap-1 rounded-full bg-black/60 px-1.5 text-[0.6rem] font-semibold text-danger-400">
                <span aria-hidden className="size-1.5 rounded-full bg-danger-400" />
                REC
              </span>
            )}
            <Tooltip label={t(`video.tile.signal.${session?.signal ?? 'good'}`)}>
              <span
                aria-hidden
                className="size-2 rounded-full shadow-[0_0_0_2px_rgba(0,0,0,0.6)]"
                style={{ background: signalColor(session?.signal) }}
              />
            </Tooltip>
          </div>
        )}

        {/* Bottom control bar */}
        {!compact && (
          <div className="absolute inset-x-0 bottom-0 flex items-center gap-1 bg-gradient-to-t from-black/75 to-transparent px-1.5 py-1">
            <TileControl
              title={t('video.tile.snapshot')}
              onClick={handleSnapshot}
              disabled={connecting}
            >
              <ImageDown size={15} />
            </TileControl>
            <TileControl
              title={muted ? t('video.tile.unmute') : t('video.tile.mute')}
              onClick={() => setMuted((m) => !m)}
            >
              {muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
            </TileControl>
            {/* Quality menu */}
            <Dropdown
              aria-label={t('video.tile.quality')}
              trigger={<Settings2 size={15} aria-hidden />}
              triggerClassName="inline-flex size-[26px] items-center justify-center rounded-md bg-black/40 text-gray-200 transition-colors hover:bg-black/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 cursor-pointer border-none"
            >
              {QUALITIES.map((q) => (
                <DropdownItem
                  key={q}
                  onClick={() => {
                    setQuality(q);
                    changeQuality(q);
                  }}
                >
                  {t(`video.quality.${q}`)}
                </DropdownItem>
              ))}
            </Dropdown>
            {onTogglePin && (
              <TileControl title={t('video.tile.spotlight')} onClick={onTogglePin} active={pinned}>
                <Pin size={15} fill={pinned ? 'currentColor' : 'none'} />
              </TileControl>
            )}
            <TileControl title={t('video.tile.fullscreen')} onClick={handleFullscreen}>
              <Maximize2 size={15} />
            </TileControl>
            {onRemove && (
              <TileControl title={t('video.tile.remove')} onClick={onRemove}>
                <X size={15} />
              </TileControl>
            )}
          </div>
        )}
      </div>
      <TileLabel label={channel.label} compact={compact} />
    </TileFrame>
  );

  function handleSnapshot() {
    if (!videoRef.current || !channel) return;
    snapshot.mutate({ video: videoRef.current, channelId: channel.id });
  }

  async function handleFullscreen() {
    if (containerRef.current) await toggleFullscreen(containerRef.current);
  }
}

/** Shared tile frame: the bordered, rounded wrapper carrying the alert ring. */
function TileFrame({
  label,
  alert,
  children,
}: {
  label: string;
  alert: boolean;
  children: ReactNode;
}) {
  return (
    <div
      data-tile={label}
      className={`relative min-h-0 min-w-0 overflow-hidden rounded-lg bg-black ${
        alert
          ? 'border-2 border-danger-600 shadow-[0_0_0_1px_#DC2626,0_0_12px_rgba(220,38,38,0.5)]'
          : 'border border-gray-700'
      }`}
      style={{ width: '100%', height: '100%' }}
    >
      {children}
    </div>
  );
}

/** Channel label overlay (bottom-end) + cabin-cam badge. */
function TileLabel({ label, compact }: { label: string; compact: boolean }) {
  const { t } = useTranslation();
  const cabin = label.toLowerCase().includes('driver');
  return (
    <div
      className="pointer-events-none absolute end-1.5 flex items-center gap-1.5"
      style={{ bottom: compact ? 4 : 28 }}
    >
      {cabin && (
        <span className="inline-flex h-4 items-center gap-1 rounded-full bg-black/60 px-1.5 text-[0.55rem] font-semibold text-warning-400">
          <Sparkles size={10} aria-hidden />
          {t('video.tile.cabinCam')}
        </span>
      )}
      <span
        className="inline-flex h-[18px] max-w-[180px] items-center truncate rounded-full bg-black/60 px-1.5 text-[0.65rem] text-gray-200"
        style={{ maxWidth: compact ? 90 : 180, fontSize: compact ? '0.55rem' : '0.65rem' }}
      >
        {label}
      </span>
    </div>
  );
}

/** Small icon-button in the control bar — real button + aria-label. */
function TileControl({
  title,
  onClick,
  children,
  disabled,
  active,
}: {
  title: string;
  onClick: () => void;
  children: ReactNode;
  disabled?: boolean;
  active?: boolean;
}) {
  return (
    <Tooltip label={title}>
      <button
        type="button"
        aria-label={title}
        disabled={disabled}
        onClick={onClick}
        className={`inline-flex size-[26px] cursor-pointer items-center justify-center rounded-md border-none bg-black/40 transition-colors hover:bg-black/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:cursor-not-allowed disabled:opacity-50 ${
          active ? 'text-brand-400' : 'text-gray-200'
        }`}
      >
        {children}
      </button>
    </Tooltip>
  );
}
