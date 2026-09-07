import { isMdvrChannel } from '@/components/video/useStreamSession';
import type { CameraChannel } from '@/types/video.types';

/** Unique MDVR units present in the channel catalog (one row per deviceId). */
export function mdvrDevicesFromChannels(
  channels: readonly CameraChannel[],
): Array<{ deviceId: string; label: string; imei?: string }> {
  const seen = new Map<string, { deviceId: string; label: string; imei?: string }>();
  for (const ch of channels) {
    if (!isMdvrChannel(ch) || !ch.deviceId) continue;
    if (seen.has(ch.deviceId)) continue;
    seen.set(ch.deviceId, {
      deviceId: ch.deviceId,
      label: ch.sourceLabel || ch.label,
      imei: ch.imei,
    });
  }
  return [...seen.values()];
}

/**
 * Pick the driver-facing camera for DMS calibration.
 *
 * MD300 DMS is typically logical channel 2. Prefer an explicit driver/cabin
 * label when the media registry has one.
 */
export function pickDmsChannel(
  channels: readonly CameraChannel[],
  deviceId: string,
): CameraChannel | null {
  const mine = channels
    .filter((c) => isMdvrChannel(c) && c.deviceId === deviceId)
    .slice()
    .sort((a, b) => (a.logicalChannel ?? 99) - (b.logicalChannel ?? 99));
  if (mine.length === 0) return null;
  return (
    mine.find((c) => c.facing === 'driver' || c.cabinCam) ??
    mine.find((c) => c.logicalChannel === 2) ??
    mine[0] ??
    null
  );
}
