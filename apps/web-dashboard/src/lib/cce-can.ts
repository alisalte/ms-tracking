import type { CceCan, CceRecord } from '@/types/fleet.types';

/** Scaled CAN fields of one reading, joined for the popup; null when none are set. */
function canParts(
  can: CceCan,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string | null {
  const parts: string[] = [];
  if (typeof can.rpm === 'number') parts.push(`${can.rpm} rpm`);
  if (typeof can.fuelLevelPct === 'number') {
    parts.push(t('map.popup.canFuel', { pct: can.fuelLevelPct }));
  }
  if (typeof can.acceleratorPedalPct === 'number') {
    parts.push(t('map.popup.canPedal', { pct: can.acceleratorPedalPct }));
  }
  if (typeof can.coolantTempC === 'number') {
    parts.push(t('map.popup.canCoolant', { temp: can.coolantTempC }));
  }
  if (typeof can.tachographSpeedKph === 'number') {
    parts.push(`${can.tachographSpeedKph} km/h`);
  }
  if (typeof can.engineHours === 'number') {
    parts.push(t('map.popup.canHours', { hours: can.engineHours }));
  }
  if (parts.length === 0) return can.ids.length > 0 ? can.ids.join(' ') : null;
  return parts.join(' · ');
}

/**
 * One CAN line for the map popup.
 * Missing record → unknown. A packet without CAN falls back to the last reading
 * the server remembered (`lastCan`), with the time it was received.
 */
export function formatCanFact(
  cce: CceRecord | null | undefined,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  if (!cce) return t('map.popup.canUnknown');
  if (cce.can.present) return canParts(cce.can, t) ?? t('map.popup.canUnknown');
  const last = cce.lastCan;
  const lastParts = last ? canParts(last, t) : null;
  if (last && lastParts) {
    return t('map.popup.canLast', { value: lastParts, time: formatSeenAt(last.seenAt) });
  }
  return t('map.popup.canAbsent');
}

function formatSeenAt(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

/**
 * Device line for the map popup: power, signal and GPS quality from the CCE
 * status IDs. Missing record or no status IDs → unknown.
 */
export function formatDeviceFact(
  cce: CceRecord | null | undefined,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  const s = cce?.status;
  if (!s) return t('map.popup.canUnknown');
  const parts: string[] = [];
  if (typeof s.externalPowerV === 'number') {
    parts.push(t('map.popup.devicePower', { volts: s.externalPowerV }));
  }
  if (typeof s.batteryPct === 'number') {
    parts.push(t('map.popup.deviceBattery', { pct: s.batteryPct }));
  }
  if (typeof s.gsmSignal === 'number') {
    parts.push(t('map.popup.deviceGsm', { level: s.gsmSignal }));
  }
  if (typeof s.satellites === 'number') {
    parts.push(t('map.popup.deviceSats', { count: s.satellites }));
  }
  if (typeof s.altitudeM === 'number') parts.push(`${s.altitudeM} m`);
  if (s.temperatures?.length) {
    parts.push(s.temperatures.map((x) => `${x.celsius}°C`).join(' / '));
  }
  if (s.cameras) {
    parts.push(
      t('map.popup.deviceCameras', {
        connected: s.cameras.connected.length,
        supported: s.cameras.supported,
      }),
    );
  }
  if (parts.length === 0) return t('map.popup.canUnknown');
  return parts.join(' · ');
}
