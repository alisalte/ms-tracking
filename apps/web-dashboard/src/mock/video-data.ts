import type {
  CameraChannel,
  CameraFacing,
  StreamQuality,
  StreamSession,
  VideoWall,
  WallDivision,
  WallTile,
} from '@/types/video.types';
/**
 * Static mock video data — the video wall's single demo data source.
 *
 * Camera channels are derived deterministically from the existing mock fleet
 * (`mockMapVehicles`) so labels/drivers stay consistent across the Map and
 * Video surfaces, plus a handful of fixed-site CCTV cameras. When the
 * `media-service` REST + Socket.IO signaling backends land, `api/video.api.ts`
 * swaps these constants for `apiGet` calls + wire→camelCase mapping — the types
 * and UI stay unchanged.
 */
import { mockMapVehicles } from './fleet-data';

/** Tiny deterministic PRNG (mulberry32) — no Math.random so tests are stable. */
function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Vehicle camera mountings — forward/driver/rear/cargo (10 §6.2). */
const VEHICLE_FACINGS: CameraFacing[] = ['forward', 'driver', 'rear', 'cargo'];

/** Human label fragment per vehicle facing. */
const FACING_LABEL: Record<CameraFacing, string> = {
  forward: 'Forward',
  driver: 'Driver',
  rear: 'Rear',
  cargo: 'Cargo',
  site: 'Site',
};

/** Fixed-site CCTV cameras (VideoPlatform §1 broadened scope). */
interface SiteCameraSeed {
  id: string;
  sourceLabel: string;
  facing: CameraFacing;
}

const SITE_CAMERAS: SiteCameraSeed[] = [
  { id: 'site-gate1', sourceLabel: 'Main Gate', facing: 'site' },
  { id: 'site-gate2', sourceLabel: 'Side Gate', facing: 'site' },
  { id: 'site-docka', sourceLabel: 'Dock A', facing: 'site' },
  { id: 'site-dockb', sourceLabel: 'Dock B', facing: 'site' },
  { id: 'site-yard', sourceLabel: 'Yard', facing: 'site' },
  { id: 'site-office', sourceLabel: 'Office', facing: 'site' },
  { id: 'site-parking', sourceLabel: 'Parking', facing: 'site' },
  { id: 'site-perimeter', sourceLabel: 'Perimeter', facing: 'site' },
];

/**
 * Build the channel catalog deterministically.
 *
 * Each *online* vehicle gets its 4 cameras (cabin-cam flag on the driver
 * facing; consent varies so the privacy-disabled branch is exercised). Offline
 * vehicles are skipped (no source pull possible). Site cameras are appended.
 */
function buildMockChannels(): CameraChannel[] {
  const rand = seeded(20260809);
  const channels: CameraChannel[] = [];

  for (const v of mockMapVehicles) {
    if (!v.ignitionOn && v.state === 'offline') continue; // offline = no cameras
    const online = v.state !== 'offline';
    for (const facing of VEHICLE_FACINGS) {
      const cabinCam = facing === 'driver';
      // Most drivers consent; ~1 in 6 do not (channel disabled, INV-MED02).
      const consentGiven = !cabinCam || rand() > 0.16;
      channels.push({
        id: `${v.id}-${facing}`,
        label: `${v.label} · ${FACING_LABEL[facing]}`,
        facing,
        sourceType: 'vehicle',
        sourceId: v.id,
        sourceLabel: v.label,
        codec: rand() > 0.7 ? 'H265' : 'H264',
        online,
        recordingActive: online && rand() > 0.7,
        aiEnabled: online && rand() > 0.5,
        cabinCam,
        consentGiven,
      });
    }
  }

  for (const s of SITE_CAMERAS) {
    channels.push({
      id: s.id,
      label: `${s.sourceLabel} · Camera`,
      facing: 'site',
      sourceType: 'site',
      sourceId: s.id,
      sourceLabel: s.sourceLabel,
      codec: 'H264',
      online: true,
      recordingActive: seeded(s.id.length * 131)() > 0.6,
      aiEnabled: true,
      cabinCam: false,
      consentGiven: true,
    });
  }

  return channels;
}

export const mockChannels: CameraChannel[] = buildMockChannels();

/** Build an empty tile set for a given division (all slots unassigned). */
export function emptyTiles(division: WallDivision): WallTile[] {
  return Array.from({ length: division }, (_, slot) => ({
    slot,
    channelId: null,
    pinned: false,
  }));
}

/** Auto-fill a tile set with the first N online channels (deterministic). */
export function autoFillTiles(
  division: WallDivision,
  pool: CameraChannel[] = mockChannels,
): WallTile[] {
  const online = pool.filter((c) => c.online && c.consentGiven);
  return Array.from({ length: division }, (_, slot) => ({
    slot,
    channelId: online[slot]?.id ?? null,
    pinned: false,
  }));
}

/** Two saved wall layouts (VideoPlatform §10.2.1) for the loader dropdown. */
export const mockVideoWalls: VideoWall[] = [
  {
    id: 'wall-gates',
    name: 'All Gates & Docks',
    division: 9,
    tiles: autoFillTiles(
      9,
      mockChannels.filter((c) => c.sourceType === 'site'),
    ),
  },
  {
    id: 'wall-risk',
    name: 'High-risk Fleet',
    division: 16,
    tiles: autoFillTiles(
      16,
      mockChannels.filter((c) => c.facing === 'forward'),
    ),
  },
];

/**
 * Mint a mock stream session for a channel + quality.
 *
 * Simulates the `POST /streams` lifecycle: a sessionId, the 5-min signaling
 * token, and a websocket URL. The synthetic `MediaStream` is produced by the
 * stream library (`lib/video-stream.ts`) so this stays wire-shaped.
 */
export function mockStreamSession(channel: CameraChannel, quality: StreamQuality): StreamSession {
  return {
    sessionId: `ss-${channel.id}-${Date.now().toString(36)}`,
    channelId: channel.id,
    quality,
    signalingToken: `tok_${Math.random().toString(36).slice(2)}${Math.random()
      .toString(36)
      .slice(2)}`,
    websocketUrl: 'wss://media.fleetvision.local/ws/media',
    state: 'connecting',
    latencyMs: 0,
    signal: 'good',
    startedAt: new Date().toISOString(),
  };
}
