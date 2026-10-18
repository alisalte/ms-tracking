import type { CceRecord } from '@/types/fleet.types';

/**
 * One line for the map popup.
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
