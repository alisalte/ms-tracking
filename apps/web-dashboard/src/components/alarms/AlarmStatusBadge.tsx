/**
 * AlarmStatusBadge — a colored chip rendering an alarm's lifecycle state
 * (12_Alarm_Engine.md §6.2: raised / acked / escalated / resolved).
 */
import type { AlarmStatus } from '@/types/alarm.types';
import { statusColor } from './AlarmTypeIcon';

interface AlarmStatusBadgeProps {
  status: AlarmStatus;
  /** Already-translated label (e.g. t('alarms.status.raised')). */
  label: string;
  size?: 'small' | 'medium';
}

export function AlarmStatusBadge({ status, label, size = 'small' }: AlarmStatusBadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full font-semibold text-white ${
        size === 'small' ? 'h-5 px-2 text-[0.7rem]' : 'h-6 px-2.5 text-xs'
      }`}
      style={{ backgroundColor: statusColor(status) }}
    >
      {label}
    </span>
  );
}
