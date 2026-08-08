/**
 * AlarmStatusBadge — a colored chip rendering an alarm's lifecycle state
 * (12_Alarm_Engine.md §6.2: raised / acked / escalated / resolved).
 */
import { Chip } from '@mui/material';

import type { AlarmStatus } from '@/types/alarm.types';
import { statusColor } from './AlarmTypeIcon';

interface AlarmStatusBadgeProps {
  status: AlarmStatus;
  /** i18n key fragment, e.g. "raised" — rendered as `alarms.status.raised`. */
  label: string;
  size?: 'small' | 'medium';
}

export function AlarmStatusBadge({ status, label, size = 'small' }: AlarmStatusBadgeProps) {
  const color = statusColor(status);
  return (
    <Chip
      size={size}
      label={label}
      sx={{
        height: size === 'small' ? 20 : 24,
        fontSize: size === 'small' ? '0.7rem' : '0.75rem',
        fontWeight: 600,
        color: '#fff',
        bgcolor: color,
        '& .MuiChip-label': { px: 1 },
      }}
    />
  );
}
