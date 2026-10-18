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

import { DEFAULT_MDVR_CHANNEL_NOS, alignCameraCatalog } from '@/lib/camera-presence';
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
      const [
        { fetchAllVehiclesAsMap },
        { formatVehicleLabel },
        { isUuid },
        { fetchDeviceStatuses, fetchLatestPositions },
      ] = await Promise.all([
        import('./asset.api'),
        import('@/lib/vehicle-label'),
        import('@/lib/ids'),
        import('./fleet.api'),
      ]);
      const [wires, registry, statuses, positions] = await Promise.all([
        apiGetRaw<MediaChannelWire[]>('/media/channels'),
        fetchAllVehiclesAsMap().catch(() => ({
          vehicles: [] as Array<{ id: string; name: string; code: string; plate: string | null }>,
          devices: [] as Array<{
            id: string;
            vehicleId: string | null;
            imei?: string;
            protocol?: string;
            status?: string;
          }>,
        })),
        fetchDeviceStatuses().catch(() => []),
        fetchLatestPositions().catch(() => []),
      ]);
      const vehicleLabel = new Map(
        registry.vehicles.map((v) => [v.id, formatVehicleLabel(v) || v.name || v.code] as const),
      );
      // deviceId → IMEI / bound vehicle (media wire sometimes omits endpoint).
      const deviceImei = new Map<string, string>();
      const deviceVehicle = new Map<string, string>();
      for (const d of registry.devices ?? []) {
        if (d.imei?.trim()) deviceImei.set(d.id, d.imei.trim());
        if (d.vehicleId) deviceVehicle.set(d.id, d.vehicleId);
      }
      const rows = wires.map((w) => {
        const ch = mapMediaChannel(w);
        const imei = (
          w.endpoint?.trim() ||
          (w.deviceId ? deviceImei.get(w.deviceId) : undefined) ||
          ch.imei
        )?.trim();
        const vehicleId =
          w.vehicleId || (w.deviceId ? deviceVehicle.get(w.deviceId) : undefined) || null;
        const named = vehicleId ? vehicleLabel.get(vehicleId) : undefined;
        const sourceLabel = formatChannelSourceLabel({
          vehicleName: named,
          imei,
          deviceId: w.deviceId,
          channelLabel: ch.label,
          isUuid,
        });
        return {
          ...ch,
          sourceId: vehicleId || w.deviceId || w.siteId || ch.sourceId,
          sourceLabel,
          imei: imei || ch.imei,
          deviceId: w.deviceId ?? ch.deviceId,
        };
      });
      // GPS presence (the map's online chip), not media-channel REGISTERED/OFFLINE.
      return alignCameraCatalog({
        channels: rows,
        devices: registry.devices ?? [],
        statuses,
        fixes: positions.map((p) => ({ vehicleId: p.vehicleId, capturedAt: p.capturedAt })),
        vehicleLabel: (id) => vehicleLabel.get(id),
      });
    },
    () => resolveMock(mockChannels),
  );
}

/** Operator-facing device caption — never a bare "CH1" / channel label. */
export function formatChannelSourceLabel(opts: {
  vehicleName?: string | null;
  imei?: string | null;
  deviceId?: string | null;
  channelLabel: string;
  isUuid: (v: string | null | undefined) => boolean;
}): string {
  const vehicle = opts.vehicleName?.trim();
  const imei = opts.imei?.trim();
  if (vehicle) {
    if (imei && imei.length >= 6) return `${vehicle} · …${imei.slice(-6)}`;
    return vehicle;
  }
  if (imei) {
    return /^\d{10,20}$/.test(imei) ? `IMEI ${imei}` : imei;
  }
  const deviceId = opts.deviceId?.trim();
  if (deviceId && !opts.isUuid(deviceId)) return deviceId;
  if (deviceId) return `Device ${deviceId.slice(0, 8)}`;
  return opts.channelLabel;
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

/**
 * Wire → UI channel mapping. Media REGISTERED counts as online only until GPS
 * presence is applied (`alignCameraCatalog`) — the map is the source of truth.
 * Exported for tests.
 */
export function mapMediaChannelForTest(w: MediaChannelWire): CameraChannel {
  return mapMediaChannel(w);
}

function mapMediaChannel(w: MediaChannelWire): CameraChannel {
  const chNum = w.logicalChannel ?? null;
  const label = w.label?.trim() || (chNum != null ? `CH${chNum}` : 'Camera');
  const lowered = label.toLowerCase();
  const sourceId = w.deviceId || w.vehicleId || w.siteId || '';
  // Prefer IMEI / device until the vehicle registry join fills `sourceLabel`.
  const imei = w.endpoint?.trim() || undefined;
  const sourceLabel = formatChannelSourceLabel({
    vehicleName: null,
    imei,
    deviceId: w.deviceId,
    channelLabel: label,
    isUuid: (v) =>
      typeof v === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v),
  });
  return {
    id: w.channelId,
    label,
    facing: lowered.includes('driver')
      ? 'driver'
      : lowered.includes('rear')
        ? 'rear'
        : lowered.includes('cargo')
          ? 'cargo'
          : 'forward',
    sourceType: w.vehicleId ? 'vehicle' : 'site',
    sourceId,
    sourceLabel,
    codec: w.codec === 'H265' ? 'H265' : 'H264',
    online: w.status !== 'OFFLINE' && w.status !== 'DECOMMISSIONED',
    recordingActive: false,
    aiEnabled: false,
    cabinCam: lowered.includes('driver'),
    consentGiven: true,
    protocol: w.protocol,
    deviceId: w.deviceId ?? undefined,
    logicalChannel: w.logicalChannel ?? undefined,
    imei,
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
 * Base RTMP/HLS key as md300-main `live.js` (`RTMP_PATH = live/md300`).
 *
 * The MD300 drops extra path SEGMENTS, so a camera cannot be addressed by a
 * sub-path. The stream NAME is honoured, so each device and each camera gets
 * its own key. A shared `live/md300` made every vehicle on the wall publish
 * to the same MediaMTX path and kick the RTMP handshake before HLS existed.
 */
export const MDVR_RTMP_PATH =
  import.meta.env.VITE_MDVR_RTMP_PATH?.replace(/^\/+/, '') || 'live/md300';

/**
 * Per-device, per-camera stream key.
 *
 * `live/md300_<imei>` for channel 1, `live/md300_<imei>_<channel>` otherwise.
 * Without an IMEI the historical bare key is kept (`live/md300`, `live/md300_2`).
 * Keep in sync with `mdvrChannelStreamPath` (fleet-management),
 * `infra/docker/mediamtx.yml` and the nginx `/media-hls` map.
 */
export function mdvrStreamKey(imei?: string, logicalChannel = 1): string {
  const id = (imei ?? '').replace(/\D/g, '');
  const root = id ? `${MDVR_RTMP_PATH}_${id}` : MDVR_RTMP_PATH;
  const n = Number(logicalChannel);
  return Number.isFinite(n) && n > 1 ? `${root}_${n}` : root;
}

/** Host:port the device is told to push RTMP to (rewritten off-loopback server-side). */
export function mdvrRtmpUploadUrl(imei?: string, logicalChannel = 1): string {
  const server = import.meta.env.VITE_MDVR_PUBLIC_HOST || window.location.hostname;
  const tcpPort = Number(import.meta.env.VITE_MDVR_RTMP_PORT ?? 1935);
  return `rtmp://${server}:${tcpPort}/${mdvrStreamKey(imei, logicalChannel)}`;
}

/** Same-origin HLS playlist (nginx `/media-hls` → MediaMTX :8888). */
export function mdvrHlsUrl(imei?: string, logicalChannel = 1): string {
  return `${window.location.protocol}//${window.location.host}/media-hls/${mdvrStreamKey(imei, logicalChannel)}/index.m3u8`;
}

/**
 * Raw ingest playlist (no ffmpeg `_web` rewrite). A 200 here means the device
 * is already publishing RTMP; the wall must not send another AB2 or MediaMTX
 * drops the publisher (`type 0/2 chunk but expected type 3`).
 */
export function mdvrIngestHlsUrl(imei?: string, logicalChannel = 1): string {
  return `${window.location.protocol}//${window.location.host}/media-hls-ingest/${mdvrStreamKey(imei, logicalChannel)}/index.m3u8`;
}

/**
 * HLS and raw-ingest playlists for the RTMP URL the server actually put in
 * the AB2/AB4 body. The player must follow that path: it is the one the
 * device was told to publish.
 */
export function mdvrUrlsFromRtmp(uploadUrl: string): { hls: string; ingest: string } | null {
  try {
    const path = new URL(uploadUrl).pathname.replace(/^\/+|\/+$/g, '');
    if (!path) return null;
    const origin = `${window.location.protocol}//${window.location.host}`;
    return {
      hls: `${origin}/media-hls/${path}/index.m3u8`,
      ingest: `${origin}/media-hls-ingest/${path}/index.m3u8`,
    };
  } catch {
    return null;
  }
}

/**
 * AB4 carries `<key>/pb` and the unit really does publish the SD-card stream
 * there — verified against a live MD300: while `live/md300` carried the live
 * camera, `live/md300/pb` had its own RTMP publisher with its own H.264 track.
 *
 * The player must therefore watch `/pb`. Watching the bare live key (what this
 * code used to do, on the assumption that the unit dropped the extra segment)
 * shows the LIVE camera while a recording is playing — the recording streams on
 * into a path with zero readers.
 */
export function mdvrPlaybackStreamKey(imei?: string, logicalChannel = 1): string {
  return `${mdvrStreamKey(imei, logicalChannel)}/pb`;
}

export function mdvrPlaybackRtmpUrl(imei?: string, logicalChannel = 1): string {
  const server = import.meta.env.VITE_MDVR_PUBLIC_HOST || window.location.hostname;
  const tcpPort = Number(import.meta.env.VITE_MDVR_RTMP_PORT ?? 1935);
  return `rtmp://${server}:${tcpPort}/${mdvrPlaybackStreamKey(imei, logicalChannel)}`;
}

/** HLS for the recording, NOT the live camera (nginx passes `/pb` straight through). */
export function mdvrPlaybackHlsUrl(imei?: string, logicalChannel = 1): string {
  return `${window.location.protocol}//${window.location.host}/media-hls/${mdvrPlaybackStreamKey(imei, logicalChannel)}/index.m3u8`;
}

/**
 * Meitrack AB4/AB5/AB8 timestamp: YYMMDDHHMMSS on the device clock.
 *
 * MD300 event files are stamped in UTC (a JPEG named `20261018121349_…` is
 * the same instant as `raisedAt` `2026-10-18T12:13:49Z`). Sending the
 * operator's local wall clock — Iran is UTC+3:30 — asks for 15:43 and the
 * unit answers FFF5 (no file). This matches `toMdvrBcdUtc` on the server.
 */
export function toMdvrBcdTime(ms: number): string {
  const d = new Date(ms);
  if (!Number.isFinite(d.getTime())) return '000000000000';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${String(d.getUTCFullYear()).slice(-2)}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
}

/** Inverse of `toMdvrBcdTime` — 12-digit device BCD (UTC) → epoch ms. */
export function fromMdvrBcdTime(bcd: string): number {
  const s = String(bcd).replace(/\D/g, '').padStart(12, '0').slice(0, 12);
  const yy = Number(s.slice(0, 2));
  const year = yy >= 70 ? 1900 + yy : 2000 + yy;
  return Date.UTC(
    year,
    Number(s.slice(2, 4)) - 1,
    Number(s.slice(4, 6)),
    Number(s.slice(6, 8)),
    Number(s.slice(8, 10)),
    Number(s.slice(10, 12)),
  );
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
  /** D01 filename when this row is a JPEG (D00 download). */
  filename?: string;
}

export function mdvrResourceKind(avType: number): 'video' | 'photo' {
  return avType === 4 ? 'photo' : 'video';
}

/** Parse `response_text` JSON written by the D01 photo-list command-ack. */
export function parseMdvrPhotoListAck(responseText: string | null | undefined): string[] {
  if (!responseText) return [];
  try {
    const parsed = JSON.parse(responseText) as { photoNames?: unknown };
    if (!Array.isArray(parsed.photoNames)) return [];
    return parsed.photoNames.filter(
      (name): name is string => typeof name === 'string' && name.trim().length > 0,
    );
  } catch {
    return [];
  }
}
/** Parse `response_text` JSON written by the D00 photo-download command-ack. */
export function parseMdvrPhotoAck(
  responseText: string | null | undefined,
): { filename: string; bytes: Uint8Array } | null {
  if (!responseText) return null;
  try {
    const parsed = JSON.parse(responseText) as { filename?: unknown; photoBase64?: unknown };
    if (typeof parsed.photoBase64 !== 'string' || parsed.photoBase64.length === 0) return null;
    const binary = atob(parsed.photoBase64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const filename =
      typeof parsed.filename === 'string' && parsed.filename.trim()
        ? parsed.filename.trim()
        : 'event.jpg';
    return { filename, bytes };
  } catch {
    return null;
  }
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
export { DEFAULT_MDVR_CHANNEL_NOS };

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
