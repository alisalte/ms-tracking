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
    async () => {
      const rows = (await apiGetRaw<MediaChannelWire[]>('/media/channels')).map(mapMediaChannel);
      rows.sort(
        (a, b) =>
          (a.logicalChannel ?? 99) - (b.logicalChannel ?? 99) || a.label.localeCompare(b.label),
      );
      return rows;
    },
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
  const sourceId = w.vehicleId ?? w.siteId ?? w.deviceId ?? '';
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
    sourceId,
    sourceLabel: w.endpoint ? `MDVR ${w.endpoint}` : label,
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

// ── MDVR live stream (AB2 RTMP push + MediaMTX HLS) ─────────────────────────

/**
 * md300-main `live.js` used a single `live/md300` key. A 2-camera MDVR needs
 * a distinct RTMP/HLS path per logical channel (`live/md300/1`, `live/md300/2`)
 * so two AB2 pushes do not overwrite each other on MediaMTX.
 */
export const MDVR_RTMP_PATH =
  import.meta.env.VITE_MDVR_RTMP_PATH?.replace(/^\/+/, '') || 'live/md300';

export function mdvrStreamKey(logicalChannel = 1): string {
  const n = Number(logicalChannel);
  const ch = Number.isInteger(n) && n >= 1 ? n : 1;
  return `${MDVR_RTMP_PATH}/${ch}`;
}

/** Host:port the device is told to push RTMP to (rewritten off-loopback server-side). */
export function mdvrRtmpUploadUrl(_imei?: string, logicalChannel = 1): string {
  const server = import.meta.env.VITE_MDVR_PUBLIC_HOST || window.location.hostname;
  const tcpPort = Number(import.meta.env.VITE_MDVR_RTMP_PORT ?? 1935);
  return `rtmp://${server}:${tcpPort}/${mdvrStreamKey(logicalChannel)}`;
}

/** Same-origin HLS playlist (nginx `/media-hls` → MediaMTX :8888). */
export function mdvrHlsUrl(_imei?: string, logicalChannel = 1): string {
  return `${window.location.protocol}//${window.location.host}/media-hls/${mdvrStreamKey(logicalChannel)}/index.m3u8`;
}

/**
 * AB4 still carries `live/md300/{n}/pb` so the command is distinct from live
 * AB2. The MD300 ACKs that URL but publishes the three-part live key
 * (`live/md300/{n}`) — extra path is dropped. The HLS player must therefore
 * watch the live key, not `/pb`.
 */
export function mdvrPlaybackStreamKey(logicalChannel = 1): string {
  return `${mdvrStreamKey(logicalChannel)}/pb`;
}

export function mdvrPlaybackRtmpUrl(_imei?: string, logicalChannel = 1): string {
  const server = import.meta.env.VITE_MDVR_PUBLIC_HOST || window.location.hostname;
  const tcpPort = Number(import.meta.env.VITE_MDVR_RTMP_PORT ?? 1935);
  return `rtmp://${server}:${tcpPort}/${mdvrPlaybackStreamKey(logicalChannel)}`;
}

export function mdvrPlaybackHlsUrl(_imei?: string, logicalChannel = 1): string {
  return mdvrHlsUrl(_imei, logicalChannel);
}

/** Meitrack AB4/AB5/AB8 timestamp: YYMMDDHHMMSS in the operator's local clock. */
export function toMdvrBcdTime(ms: number): string {
  const d = new Date(ms);
  if (!Number.isFinite(d.getTime())) return '000000000000';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${String(d.getFullYear()).slice(-2)}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/** Inverse of `toMdvrBcdTime` — 12-digit BCD → epoch ms in the operator's local clock. */
export function fromMdvrBcdTime(bcd: string): number {
  const s = String(bcd).replace(/\D/g, '').padStart(12, '0').slice(0, 12);
  const yy = Number(s.slice(0, 2));
  const year = yy >= 70 ? 1900 + yy : 2000 + yy;
  const d = new Date(
    year,
    Number(s.slice(2, 4)) - 1,
    Number(s.slice(4, 6)),
    Number(s.slice(6, 8)),
    Number(s.slice(8, 10)),
    Number(s.slice(10, 12)),
  );
  return d.getTime();
}

/** One MDVR SD-card file from an AB8 resource-list ACK. */
export interface MdvrResource {
  channel: number;
  startTime: string;
  endTime: string;
  avType: number;
  streamType: number;
  capType: number;
  fileLen: number;
  eventCode: number;
  subEventCode: number;
}

export function mdvrResourceKind(avType: number): 'video' | 'photo' {
  return avType === 4 ? 'photo' : 'video';
}

/** Parse `response_text` JSON written by the AB8 command-ack consumer. */
export function parseMdvrResourceAck(responseText: string | null | undefined): MdvrResource[] {
  if (!responseText) return [];
  try {
    const parsed = JSON.parse(responseText) as { resources?: unknown };
    if (!Array.isArray(parsed.resources)) return [];
    const out: MdvrResource[] = [];
    for (const raw of parsed.resources) {
      if (!raw || typeof raw !== 'object') continue;
      const r = raw as Record<string, unknown>;
      const startTime = String(r.startTime ?? '').replace(/\D/g, '');
      const endTime = String(r.endTime ?? '').replace(/\D/g, '');
      if (startTime.length !== 12 || endTime.length !== 12) continue;
      out.push({
        channel: Number(r.channel) || 0,
        startTime,
        endTime,
        avType: Number(r.avType) || 0,
        streamType: Number(r.streamType) || 0,
        capType: Number(r.capType) || 0,
        fileLen: Number(r.fileLen) || 0,
        eventCode: Number(r.eventCode) || 0,
        subEventCode: Number(r.subEventCode) || 0,
      });
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Start a live stream: sends AB2 (RTMP push) through the existing
 * device-command path — fleet-management builds the binary struct,
 * device-gateway writes it to the device, which then pushes to MediaMTX.
 */
export function useStartMdvrStream() {
  return useMutation<
    unknown,
    Error,
    {
      deviceId: string;
      logicalChannel: number;
      dataType?: string;
      streamType?: string;
      imei: string;
    }
  >({
    mutationFn: ({ deviceId, logicalChannel, dataType, streamType, imei }) =>
      apiPost(`/devices/${deviceId}/commands`, {
        commandCode: 'AB2',
        params: {
          uploadUrl: mdvrRtmpUploadUrl(imei, logicalChannel),
          channel: logicalChannel,
          dataType: dataType ?? '0',
          streamType: streamType ?? '0',
        },
      }),
  });
}

/** Stop a live stream: AB3 (RTMP stream control, control=0 stop). */
export function useStopMdvrStream() {
  return useMutation<unknown, Error, { deviceId: string; logicalChannel: number }>({
    mutationFn: ({ deviceId, logicalChannel }) =>
      apiPost(`/devices/${deviceId}/commands`, {
        commandCode: 'AB3',
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

/** Default MDVR camera numbers (MD300 is typically two cameras). Extra channels via the wizard. */
export const DEFAULT_MDVR_CHANNEL_NOS = [1, 2] as const;

/** Register CH1–CH2 for a bound MDVR so the video wall has something to play. */
export async function registerDefaultMdvrChannels(input: {
  vehicleId: string;
  deviceId: string;
  imei: string;
}): Promise<void> {
  for (const n of DEFAULT_MDVR_CHANNEL_NOS) {
    await apiPostRaw('/media/channels', {
      vehicleId: input.vehicleId,
      deviceId: input.deviceId,
      label: `Camera ${n}`,
      logicalChannel: n,
      protocol: 'MEITRACK_MDVR',
      codec: 'H264',
      endpoint: input.imei,
    });
  }
}
