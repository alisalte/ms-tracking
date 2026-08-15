/**
 * VideoTile — the atomic unit of the Video Wall (10 §2.2, UI_UX §0.5).
 *
 * Wraps a `LiveVideoPlayer` with the documented overlays (latency badge, REC
 * dot, signal indicator, channel label, cabin-cam badge, alert border) and the
 * control bar (snapshot, fullscreen, mute, quality menu, spotlight, remove).
 * Drives a `useStreamSession` for its channel and forwards the `<video>` ref so
 * snapshot/fullscreen operate on real pixels.
 *
 * States:
 * - empty slot → placeholder prompt to add a channel.
 * - offline / no-consent → disabled overlay (INV-MED02).
 * - connecting → skeleton + spinner.
 * - active → live video + overlays + controls.
 * - queued (wall overflow) → placeholder frame + "queued" badge.
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
import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useSnapshot } from '@/api/video.api';
import { LiveVideoPlayer } from '@/components/video/LiveVideoPlayer';
import { useStreamSession } from '@/components/video/useStreamSession';
import { toggleFullscreen } from '@/lib/video-stream';
import type { CameraChannel, StreamQuality } from '@/types/video.types';
import {
  Box,
  Chip,
  CircularProgress,
  IconButton,
  Menu,
  MenuItem,
  Tooltip,
  Typography,
} from '@mui/material';

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
  const [qualityAnchor, setQualityAnchor] = useState<HTMLElement | null>(null);
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
      <Box
        sx={{
          position: 'relative',
          width: '100%',
          height: '100%',
          minHeight: 0,
          backgroundColor: 'action.hover',
          border: '2px dashed',
          borderColor: 'divider',
          borderRadius: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Typography variant="caption" color="text.disabled">
          {t('video.tile.empty')}
        </Typography>
      </Box>
    );
  }

  // Disabled channel (offline or no consent).
  if (!channel.online || !channel.consentGiven) {
    return (
      <TileFrame label={channel.label} alert={false}>
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 1,
            backgroundColor: '#0b1220',
          }}
        >
          <Camera size={compact ? 16 : 28} color="#475569" />
          <Typography variant="caption" color="text.disabled" sx={{ px: 1, textAlign: 'center' }}>
            {t(channel.consentGiven ? 'video.tile.offline' : 'video.tile.noConsent')}
          </Typography>
        </Box>
        <TileLabel label={channel.label} compact={compact} />
      </TileFrame>
    );
  }

  // Queued (overflow) tile — placeholder frame, click to promote.
  if (!live) {
    return (
      <TileFrame label={channel.label} alert={false}>
        <Box
          onClick={onPromote}
          sx={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 1,
            backgroundColor: '#0b1220',
            cursor: onPromote ? 'pointer' : 'default',
            '&:hover': onPromote ? { backgroundColor: '#111c30' } : {},
          }}
        >
          <Chip
            size="small"
            label={t('video.tile.queued')}
            sx={{ fontSize: '0.65rem', height: 18, color: '#facc15', borderColor: '#facc15' }}
            variant="outlined"
          />
          {!compact && (
            <Typography variant="caption" color="text.disabled">
              {t('video.tile.clickToPromote')}
            </Typography>
          )}
        </Box>
        <TileLabel label={channel.label} compact={compact} />
      </TileFrame>
    );
  }

  // Live tile.
  const connecting = !stream || session?.state === 'connecting';
  return (
    <TileFrame label={channel.label} alert={alert}>
      <Box ref={containerRef} sx={{ position: 'absolute', inset: 0, backgroundColor: '#000' }}>
        <LiveVideoPlayer ref={videoRef} stream={stream} muted={muted} active />

        {/* Connecting overlay */}
        {connecting && (
          <Box
            sx={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: 'rgba(0,0,0,0.5)',
            }}
          >
            <CircularProgress size={compact ? 18 : 28} />
          </Box>
        )}

        {/* Top-left overlays: latency + REC + signal */}
        {!compact && (
          <Box
            sx={{
              position: 'absolute',
              top: 6,
              left: 6,
              display: 'flex',
              gap: 0.5,
              alignItems: 'center',
            }}
          >
            {session?.state === 'active' && (
              <Chip
                size="small"
                label={`${session.latencyMs}ms`}
                sx={{
                  height: 18,
                  fontSize: '0.6rem',
                  bgcolor: 'rgba(0,0,0,0.6)',
                  color: '#e5e7eb',
                }}
              />
            )}
            {/* Honest stream-kind badge (Sprint 3): never present a stub as real. */}
            {streamKind !== 'real' && (
              <Chip
                size="small"
                label={streamKind === 'stub' ? 'DEMO' : 'OFFLINE'}
                sx={{
                  height: 18,
                  fontSize: '0.55rem',
                  fontWeight: 700,
                  bgcolor: streamKind === 'stub' ? 'rgba(245,158,11,0.85)' : 'rgba(220,38,38,0.85)',
                  color: '#fff',
                }}
              />
            )}
            {channel.recordingActive && (
              <Chip
                size="small"
                icon={
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      background: '#fb7185',
                      display: 'inline-block',
                    }}
                  />
                }
                label="REC"
                sx={{
                  height: 18,
                  fontSize: '0.6rem',
                  bgcolor: 'rgba(0,0,0,0.6)',
                  color: '#fb7185',
                }}
              />
            )}
            <Tooltip title={t(`video.tile.signal.${session?.signal ?? 'good'}`)}>
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: signalColor(session?.signal),
                  display: 'inline-block',
                  boxShadow: '0 0 0 2px rgba(0,0,0,0.6)',
                }}
              />
            </Tooltip>
          </Box>
        )}

        {/* Bottom control bar */}
        {!compact && (
          <Box
            sx={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0,
              display: 'flex',
              alignItems: 'center',
              gap: 0.5,
              px: 0.5,
              py: 0.25,
              background: 'linear-gradient(to top, rgba(0,0,0,0.75), transparent)',
            }}
          >
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
            <TileControl
              title={t('video.tile.quality')}
              onClick={(e) => setQualityAnchor(e.currentTarget)}
            >
              <Settings2 size={15} />
            </TileControl>
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
          </Box>
        )}

        {/* Quality menu */}
        <Menu
          anchorEl={qualityAnchor}
          open={Boolean(qualityAnchor)}
          onClose={() => setQualityAnchor(null)}
        >
          {QUALITIES.map((q) => (
            <MenuItem
              key={q}
              selected={q === quality}
              onClick={() => {
                setQuality(q);
                changeQuality(q);
                setQualityAnchor(null);
              }}
            >
              {t(`video.quality.${q}`)}
            </MenuItem>
          ))}
        </Menu>
      </Box>
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
    <Box
      data-tile={label}
      sx={{
        position: 'relative',
        width: '100%',
        height: '100%',
        minHeight: 0,
        minWidth: 0,
        overflow: 'hidden',
        borderRadius: 1,
        backgroundColor: '#000',
        border: alert ? 2 : 1,
        borderColor: alert ? '#DC2626' : 'divider',
        boxShadow: alert ? '0 0 0 1px #DC2626, 0 0 12px rgba(220,38,38,0.5)' : 'none',
      }}
    >
      {children}
    </Box>
  );
}

/** Channel label overlay (bottom-right) + cabin-cam badge. */
function TileLabel({ label, compact }: { label: string; compact: boolean }) {
  const { t } = useTranslation();
  const cabin = label.toLowerCase().includes('driver');
  return (
    <Box
      sx={{
        position: 'absolute',
        bottom: compact ? 4 : 28,
        right: 4,
        display: 'flex',
        gap: 0.5,
        alignItems: 'center',
        pointerEvents: 'none',
      }}
    >
      {cabin && (
        <Chip
          size="small"
          icon={<Sparkles size={10} />}
          label={t('video.tile.cabinCam')}
          sx={{ height: 16, fontSize: '0.55rem', bgcolor: 'rgba(0,0,0,0.6)', color: '#facc15' }}
        />
      )}
      <Chip
        label={label}
        sx={{
          height: 18,
          fontSize: compact ? '0.55rem' : '0.65rem',
          maxWidth: compact ? 90 : 180,
          bgcolor: 'rgba(0,0,0,0.6)',
          color: '#e5e7eb',
        }}
      />
    </Box>
  );
}

/** Small icon-button in the control bar. */
function TileControl({
  title,
  onClick,
  children,
  disabled,
  active,
}: {
  title: string;
  onClick: (e: ReactMouseEvent<HTMLElement>) => void;
  children: ReactNode;
  disabled?: boolean;
  active?: boolean;
}) {
  return (
    <Tooltip title={title}>
      <span>
        <IconButton
          size="small"
          disabled={disabled}
          onClick={onClick}
          sx={{
            color: active ? 'primary.main' : '#e5e7eb',
            bgcolor: 'rgba(0,0,0,0.4)',
            '&:hover': { bgcolor: 'rgba(0,0,0,0.6)' },
            width: 26,
            height: 26,
          }}
        >
          {children}
        </IconButton>
      </span>
    </Tooltip>
  );
}
