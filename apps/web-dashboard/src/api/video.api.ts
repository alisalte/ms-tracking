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

import { resolveMock, shouldUseMock, withMockFallback } from '@/lib/mock-gate';
import { useCursorPagination } from '@/lib/use-cursor-pagination';
import { captureSnapshot, downloadBlob } from '@/lib/video-stream';
import { mockChannels, mockVideoWalls } from '@/mock/video-data';
import type { CameraChannel, VideoWall } from '@/types/video.types';
import { apiGetRaw, apiPost, apiPostRaw } from './client';
import { queryKeys } from './query-keys';

// ── Fetchers ─────────────────────────────────────────────────────────────────

/**
 * GET /media/channels — real media-service channel catalog. Wire fields are
 * snake_case; mapped to the UI CameraChannel shape. The `endpoint` column
 * carries the device IMEI for MEITRACK_MDVR channels (the mdvr-streamer room
 * key). In mock mode, falls back to mock data on network error.
 */
async function fetchChannels(): Promise<CameraChannel[]> {
  if (shouldUseMock()) return resolveMock(mockChannels);
  return withMockFallback(
    // apiGetRaw: media-service returns a RAW array (no { data } envelope).
    async () => (await apiGetRaw<MediaChannelWire[]>('/media/channels')).map(mapMediaChannel),
    () => resolveMock(mockChannels),
  );
}

/**
 * media-service wire row — the channel repository returns the domain object in
 * camelCase (channelId, vehicleId, logicalChannel…), NOT the raw snake_case
 * DB columns.
 */
interface MediaChannelWire {
  channelId: string;
  vehicleId: string | null;
  siteId: string | null;
  deviceId: string | null;
  label: string;
  logicalChannel: number | null;
  protocol: string;
  codec: string;
  endpoint: string | null;
  status: string;
}

/** Wire → UI channel mapping (status REGISTERED/ONLINE → online). Exported for tests. */
export function mapMediaChannelForTest(w: MediaChannelWire): CameraChannel {
  return mapMediaChannel(w);
}

function mapMediaChannel(w: MediaChannelWire): CameraChannel {
  const label = w.label || `Camera ${w.logicalChannel ?? ''}`.trim();
  const lowered = label.toLowerCase();
  return {
    id: w.channelId,
    label,
    facing: lowered.includes('driver')
      ? 'driver'
      : lowered.includes('rear')
        ? 'rear'
        : lowered.includes('cargo')
          ? 'cargo'
          : 'site',
    sourceType: w.vehicleId ? 'vehicle' : 'site',
    sourceId: (w.vehicleId ?? w.siteId ?? '') || '',
    sourceLabel: label,
    codec: w.codec === 'H265' ? 'H265' : 'H264',
    online: w.status !== 'OFFLINE' && w.status !== 'DECOMMISSIONED',
    recordingActive: false,
    aiEnabled: false,
    cabinCam: lowered.includes('driver'),
    consentGiven: true,
    protocol: w.protocol,
    deviceId: w.deviceId ?? undefined,
    logicalChannel: w.logicalChannel ?? undefined,
    imei: w.endpoint ?? undefined,
  };
}

/** GET /api/v1/media/video-walls (no backend — mock only). */
function fetchVideoWalls(): Promise<VideoWall[]> {
  if (!shouldUseMock()) return Promise.resolve([]);
  return resolveMock(mockVideoWalls);
}

// ── Hooks ────────────────────────────────────────────────────────────────────

/** Channel catalog for the wall dock (sites + vehicles). */
export function useChannels() {
  return useQuery({ queryKey: queryKeys.video.channels(), queryFn: fetchChannels });
}

/** Cursor-paginated channel list (real backend: GET /media/channels — raw array). */
export function useChannelsPage() {
  return useCursorPagination<CameraChannel>(queryKeys.video.channels(), (cursor) =>
    withMockFallback(
      async () => {
        const rows = await apiGetRaw<MediaChannelWire[]>('/media/channels', {
          limit: 25,
          ...(cursor ? { cursor } : {}),
        });
        return { data: rows.map(mapMediaChannel), nextCursor: null };
      },
      async () => ({ data: mockChannels, nextCursor: null }),
    ),
  );
}

/** Saved video wall layouts. */
export function useVideoWalls() {
  return useQuery({ queryKey: queryKeys.video.walls(), queryFn: fetchVideoWalls });
}

/**
 * Save a wall layout — `POST /api/v1/media/video-walls` (pending backend).
 *
 * Mock: resolves immediately with the saved wall (no persistence). In REAL mode
 * the mutation REJECTS honestly — there is no persistence backend, so the wall
 * would be silently lost on refresh.
 */
export function useSaveWall() {
  return useMutation<VideoWall, Error, VideoWall>({
    mutationFn: async (wall) => {
      if (!shouldUseMock()) {
        throw new Error('Saving wall layouts is not available (backend not implemented).');
      }
      return resolveMock(wall);
    },
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

// ── MDVR live stream (A9A/A9B over the platform command path) ────────────────

/** A9A server endpoint advertised to the device (its media dialback target). */
export function mdvrStreamEndpoint(): { server: string; tcpPort: number } {
  const server = import.meta.env.VITE_MDVR_PUBLIC_HOST || window.location.hostname;
  const tcpPort = Number(import.meta.env.VITE_MDVR_PUBLIC_PORT ?? 6182);
  return { server, tcpPort };
}

/** The browser-side binary MPEG-TS WebSocket for an IMEI (nginx → mdvr-streamer). */
export function mdvrWsUrl(imei: string): string {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${window.location.host}/media-live/ws?imei=${encodeURIComponent(imei)}`;
}

/**
 * Start a live stream: sends A9A (start real-time AV) through the existing
 * device-command path — fleet-management builds the §3.16 binary struct,
 * device-gateway writes it to the device, which then dials the mdvr-streamer.
 */
export function useStartMdvrStream() {
  return useMutation<
    unknown,
    Error,
    { deviceId: string; logicalChannel: number; dataType?: string; streamType?: string }
  >({
    mutationFn: ({ deviceId, logicalChannel, dataType, streamType }) => {
      const { server, tcpPort } = mdvrStreamEndpoint();
      return apiPost(`/devices/${deviceId}/commands`, {
        commandCode: 'A9A',
        params: {
          server,
          tcpPort,
          udpPort: 0,
          channel: logicalChannel,
          dataType: dataType ?? '1',
          streamType: streamType ?? '1',
        },
      });
    },
  });
}

/** Stop a live stream: A9B (control real-time AV, control=0 stop). */
export function useStopMdvrStream() {
  return useMutation<unknown, Error, { deviceId: string; logicalChannel: number }>({
    mutationFn: ({ deviceId, logicalChannel }) =>
      apiPost(`/devices/${deviceId}/commands`, {
        commandCode: 'A9B',
        params: { channel: logicalChannel, control: '0', closeType: '0', switchType: '0' },
      }),
  });
}

/** Register a camera channel on a device (media-service POST /media/channels). */
export function useRegisterChannel() {
  return useMutation<
    unknown,
    Error,
    {
      vehicleId?: string | null;
      deviceId: string;
      label: string;
      logicalChannel: number;
      imei: string;
    }
  >({
    mutationFn: (body) =>
      apiPostRaw('/media/channels', {
        vehicleId: body.vehicleId ?? null,
        deviceId: body.deviceId,
        label: body.label,
        logicalChannel: body.logicalChannel,
        protocol: 'MEITRACK_MDVR',
        codec: 'H264',
        endpoint: body.imei, // device IMEI — the mdvr-streamer room key
      }),
  });
}
