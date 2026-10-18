import type { CceRecord } from '@/types/fleet.types';

/**
 * One CAN line for the map popup.
 * Missing record → unknown. `can.present === false` → the packet was stored and had no CAN.
 */
export function formatCanFact(
  cce: CceRecord | null | undefined,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  if (!cce) return t('map.popup.canUnknown');
  if (!cce.can.present) return t('map.popup.canAbsent');
  const can = cce.can;
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
  if (parts.length === 0) return can.ids.join(' ');
  return parts.join(' · ');
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
