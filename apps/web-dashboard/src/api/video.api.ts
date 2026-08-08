/**
 * Live video API + data hooks.
 *
 * The Video Wall (UI_UX_Design.md §3, 10_Live_Video.md §6.3) needs the channel
 * catalog, saved wall layouts, and per-tile live stream sessions. None of these
 * endpoints exist in the backend yet — so each query resolves from static mock
 * data (`mock/video-data.ts`) with a small latency to mimic a real fetch and
 * exercise the loading skeleton states.
 *
 * `useStreamSession` is the one exception to the pure-fetch pattern: a live
 * `MediaStream` is a non-serializable object owning a canvas/WebRTC resource,
 * so the hook owns its lifecycle (open → negotiate → close) directly rather
 * than going through TanStack Query's cache. When the `media-service` REST +
 * Socket.IO signaling backends land, swap the mock body for `apiPost` + a real
 * `RTCPeerConnection` and the hook signature stays the same.
 */
import { useMutation, useQuery } from '@tanstack/react-query';

import { resolveMock } from '@/lib/mock-gate';
import { captureSnapshot, downloadBlob } from '@/lib/video-stream';
import { mockChannels, mockVideoWalls } from '@/mock/video-data';
import type { CameraChannel, VideoWall } from '@/types/video.types';
import { queryKeys } from './query-keys';

// ── Fetchers (swap mock → apiGet when backends land) ─────────────────────────

/** GET /api/v1/media/vehicles|sites/.../channels (pending backend). */
function fetchChannels(): Promise<CameraChannel[]> {
  return resolveMock(mockChannels);
}

/** GET /api/v1/media/video-walls (pending backend). */
function fetchVideoWalls(): Promise<VideoWall[]> {
  return resolveMock(mockVideoWalls);
}

// ── Hooks ────────────────────────────────────────────────────────────────────

/** Channel catalog for the wall dock (sites + vehicles). */
export function useChannels() {
  return useQuery({ queryKey: queryKeys.video.channels(), queryFn: fetchChannels });
}

/** Saved video wall layouts. */
export function useVideoWalls() {
  return useQuery({ queryKey: queryKeys.video.walls(), queryFn: fetchVideoWalls });
}

/**
 * Save a wall layout — `POST /api/v1/media/video-walls` (pending backend).
 *
 * Mock: resolves immediately with the saved wall (no persistence).
 */
export function useSaveWall() {
  return useMutation<VideoWall, Error, VideoWall>({
    mutationFn: async (wall) => resolveMock(wall),
  });
}

/**
 * Capture + download a JPEG snapshot of a channel's current frame —
 * `POST /api/v1/media/channels/{id}/snapshot` (VideoPlatform Appendix B).
 */
export function useSnapshot() {
  return useMutation<Blob | null, Error, { video: HTMLVideoElement; channelId: string }>({
    mutationFn: async ({ video, channelId }) => {
      const blob = await captureSnapshot(video);
      if (blob) {
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        downloadBlob(blob, `snapshot-${channelId}-${ts}.jpg`);
      }
      return blob;
    },
  });
}
