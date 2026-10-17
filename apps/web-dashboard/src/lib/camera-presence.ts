/**
 * Camera "online" uses the same presence as the live map.
 *
 * The map counts a vehicle ONLINE from gps-engine device status, and a fresh
 * GPS fix upgrades OFFLINE/STALE/UNKNOWN. Media-channel status (REGISTERED /
 * OFFLINE) is a different lifecycle — it stays REGISTERED until somebody opens
 * a stream — so the camera list was showing a different online count.
 */
import { isFreshCapturedAt, presenceFromLiveFix } from '@/lib/vehicle-motion';
import type { VehiclePresence } from '@/types/fleet.types';
import type { CameraChannel } from '@/types/video.types';

/** Default MDVR camera numbers (MD300 is typically two cameras). */
export const DEFAULT_MDVR_CHANNEL_NOS = [1, 2] as const;

export interface CameraCatalogDevice {
  id: string;
  vehicleId?: string | null;
  imei?: string | null;
  protocol?: string | null;
  status?: string | null;
}

export interface CameraCatalogStatus {
  deviceId: string;
  state: 'ONLINE' | 'OFFLINE' | 'STALE';
}

export interface CameraCatalogFix {
  vehicleId: string;
  capturedAt?: string | null;
}

export interface AlignCameraCatalogInput {
  channels: CameraChannel[];
  devices: readonly CameraCatalogDevice[];
  statuses: readonly CameraCatalogStatus[];
  fixes: readonly CameraCatalogFix[];
  vehicleLabel?: (vehicleId: string) => string | undefined;
  nowMs?: number;
}

function sourceLabelFor(
  vehicleName: string | undefined,
  imei: string | undefined,
  deviceId: string,
): string {
  if (vehicleName) {
    if (imei && imei.length >= 6) return `${vehicleName} · …${imei.slice(-6)}`;
    return vehicleName;
  }
  if (imei) return /^\d{10,20}$/.test(imei) ? `IMEI ${imei}` : imei;
  return `Device ${deviceId.slice(0, 8)}`;
}

/**
 * Devices the operator counts as "online cameras" — one per vehicle, matching
 * the map's online chip (not one per lens).
 */
export function onlineCameraDeviceCount(
  channels: readonly Pick<
    CameraChannel,
    'online' | 'consentGiven' | 'sourceId' | 'deviceId' | 'id'
  >[],
): number {
  const ids = new Set<string>();
  for (const c of channels) {
    if (!c.online || !c.consentGiven) continue;
    ids.add(c.sourceId || c.deviceId || c.id);
  }
  return ids.size;
}

/**
 * Overlay GPS presence onto catalog rows, and add CH1–CH2 for Meitrack units
 * that are on the map but were never registered with the media service.
 */
export function alignCameraCatalog(input: AlignCameraCatalogInput): CameraChannel[] {
  const nowMs = input.nowMs ?? Date.now();
  const statusByDevice = new Map(input.statuses.map((s) => [s.deviceId, s.state] as const));
  const fixByKey = new Map<string, string | null | undefined>();
  for (const fix of input.fixes) {
    if (fix.vehicleId) fixByKey.set(fix.vehicleId, fix.capturedAt);
  }

  const presenceOf = (
    deviceId: string | undefined,
    vehicleId: string | undefined | null,
  ): { presence: VehiclePresence; known: boolean } => {
    const state = deviceId ? statusByDevice.get(deviceId) : undefined;
    const captured =
      (vehicleId ? fixByKey.get(vehicleId) : undefined) ??
      (deviceId ? fixByKey.get(deviceId) : undefined);
    const fresh = isFreshCapturedAt(captured, nowMs);
    return {
      presence: presenceFromLiveFix(state ?? 'UNKNOWN', fresh),
      known: state !== undefined || fresh,
    };
  };

  const aligned = input.channels.map((ch) => {
    const vehicleId = ch.sourceType === 'vehicle' ? ch.sourceId : undefined;
    const { presence, known } = presenceOf(ch.deviceId, vehicleId);
    if (!known) return ch;
    const online = presence === 'ONLINE';
    return online === ch.online ? ch : { ...ch, online };
  });

  const covered = new Set(aligned.map((c) => c.deviceId).filter((id): id is string => Boolean(id)));
  const extra: CameraChannel[] = [];
  for (const device of input.devices) {
    if (!device.vehicleId) continue;
    if (device.status === 'DECOMMISSIONED') continue;
    if (device.protocol !== 'meitrack') continue;
    if (covered.has(device.id)) continue;
    const { presence } = presenceOf(device.id, device.vehicleId);
    const imei = device.imei?.trim() || undefined;
    const sourceLabel = sourceLabelFor(input.vehicleLabel?.(device.vehicleId), imei, device.id);
    for (const n of DEFAULT_MDVR_CHANNEL_NOS) {
      extra.push({
        id: `mdvr:${device.id}:${n}`,
        label: `Camera ${n}`,
        facing: 'forward',
        sourceType: 'vehicle',
        sourceId: device.vehicleId,
        sourceLabel,
        codec: 'H264',
        online: presence === 'ONLINE',
        recordingActive: false,
        aiEnabled: false,
        cabinCam: false,
        consentGiven: true,
        protocol: 'MEITRACK_MDVR',
        deviceId: device.id,
        logicalChannel: n,
        imei,
      });
    }
  }

  return [...aligned, ...extra].sort(
    (a, b) =>
      a.sourceLabel.localeCompare(b.sourceLabel) ||
      (a.logicalChannel ?? 99) - (b.logicalChannel ?? 99) ||
      a.label.localeCompare(b.label),
  );
}
