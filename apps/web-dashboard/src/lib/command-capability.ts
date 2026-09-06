/**
 * Which catalog commands a unit can actually run.
 *
 * The backend currently serves the Meitrack MDVR GPRS catalog as one list.
 * GPS-only trackers (T622, T3xx, …) must not be offered MDVR-only settings
 * (media, RFID, TPMS, temperature, fuel). Classification is by model name
 * because the device registry has no capability bitmap.
 */
import type { Device } from '@/types/asset.types';
import type { CommandCategory, CommandDef } from '@/types/command.types';

export type CommandDeviceClass = 'tracker' | 'mdvr';

/** Categories that only exist on MDVR / camera units. */
export const MDVR_ONLY_CATEGORIES: ReadonlySet<CommandCategory> = new Set([
  'media',
  'rfid',
  'tpms',
  'temperature',
  'fuel',
]);

const MDVR_MODEL = /^(md\d|mdvr)|mdvr|dvr|camera/i;
const TRACKER_MODEL = /^(t\d|mvt|mt\d|tc|p99|vt)|tracker|gps/i;

/** Resolve tracker vs MDVR from a device model string. Unknown → tracker (hide extras). */
export function commandClassFromModel(model: string | null | undefined): CommandDeviceClass {
  const m = (model ?? '').trim();
  if (!m) return 'tracker';
  if (MDVR_MODEL.test(m)) return 'mdvr';
  if (TRACKER_MODEL.test(m)) return 'tracker';
  return 'tracker';
}

export function commandClassFromDevice(
  device: Pick<Device, 'model'> | null | undefined,
): CommandDeviceClass {
  return commandClassFromModel(device?.model);
}

export function commandAppliesToClass(
  command: Pick<CommandDef, 'category'>,
  deviceClass: CommandDeviceClass,
): boolean {
  if (deviceClass === 'mdvr') return true;
  return !MDVR_ONLY_CATEGORIES.has(command.category);
}

export function filterCatalogForClass(
  catalog: readonly CommandDef[],
  deviceClass: CommandDeviceClass | null,
): CommandDef[] {
  if (!deviceClass) return [];
  return catalog.filter((c) => commandAppliesToClass(c, deviceClass));
}
