/**
 * AlarmStatusBadge — a colored chip rendering an alarm's lifecycle state
 * (12_Alarm_Engine.md §6.2: raised / acked / escalated / resolved), built on
 * the shared Badge primitive with the semantic status palette.
 */
import { Badge } from '@/components/tailwind-ui';
import type { AlarmStatus } from '@/types/alarm.types';
import { statusBadgeColor } from './AlarmTypeIcon';

interface AlarmStatusBadgeProps {
  status: AlarmStatus;
  /** Already-translated label (e.g. t('alarms.status.raised')). */
  label: string;
  size?: 'small' | 'medium';
}

export function AlarmStatusBadge({ status, label, size = 'small' }: AlarmStatusBadgeProps) {
  return (
    <Badge
      color={statusBadgeColor(status)}
      className={size === 'medium' ? 'px-2.5 font-semibold' : 'font-semibold'}
    >
      {label}
    </Badge>
  );
}
