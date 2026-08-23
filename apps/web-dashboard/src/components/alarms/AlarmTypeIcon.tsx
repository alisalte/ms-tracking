/**
 * Alarm visual helpers — type→icon and severity/status→color maps.
 *
 * Extracted so the list, timeline, map, and drawer share one consistent visual
 * vocabulary (12_Alarm_Engine.md §2.1 catalog + §2.11 severity matrix). Colors
 * come from the semantic palette (`theme/palette.ts` `status.*`) so the UI
 * never hardcodes hex values.
 */
import { ScanFace,
  AlertTriangle,
  Camera,
  CarFront,
  Fuel,
  Gauge,
  type LucideIcon,
  MapPin,
  Siren,
  Thermometer,
  WifiOff,
} from 'lucide-react';

import { status } from '@/theme/palette';
import type { AlarmSeverity, AlarmStatus, AlarmType } from '@/types/alarm.types';

/** Type → lucide icon (§2.1 catalog). */
const TYPE_ICON: Record<AlarmType, LucideIcon> = {
  sos: Siren,
  dms: ScanFace,
  overspeed: Gauge,
  geofence: MapPin,
  offline: WifiOff,
  'fuel-theft': Fuel,
  temperature: Thermometer,
  collision: CarFront,
  camera: Camera,
  other: AlertTriangle,
};

/** Resolve the lucide icon component for an alarm type. */
export function alarmTypeIcon(type: AlarmType): LucideIcon {
  return TYPE_ICON[type] ?? AlertTriangle;
}

/** Severity → semantic color token (§2.11). */
export function severityColor(severity: AlarmSeverity): string {
  switch (severity) {
    case 'critical':
      return status.red;
    case 'major':
      return status.amber;
    case 'minor':
      return status.blue;
    default:
      return status.slate;
  }
}

/** Status → semantic color token (§6.2). */
export function statusColor(s: AlarmStatus): string {
  switch (s) {
    case 'raised':
      return status.amber;
    case 'acked':
      return status.blue;
    case 'escalated':
      return status.red;
    default:
      return status.slate;
  }
}
