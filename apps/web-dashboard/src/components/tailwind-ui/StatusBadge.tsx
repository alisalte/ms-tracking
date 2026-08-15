import type { ReactNode } from 'react';

import { Badge } from './Badge';

/**
 * StatusBadge — maps fleet domain statuses to semantic colors.
 *
 * Centralizes the status→color mapping so alarms, vehicles, devices, and trips
 * all render consistent severity semantics (task §14: Critical/High/Medium/Low
 * hierarchy; §26: never rely on color alone — dot + label).
 */
type StatusKind =
  | 'critical'
  | 'high'
  | 'medium'
  | 'low'
  | 'info'
  | 'online'
  | 'offline'
  | 'idle'
  | 'moving'
  | 'stopped'
  | 'open'
  | 'acknowledged'
  | 'resolved';

const STATUS_COLOR: Record<StatusKind, import('./Badge').BadgeProps['color']> = {
  critical: 'danger',
  high: 'danger',
  medium: 'warning',
  low: 'info',
  info: 'info',
  online: 'success',
  offline: 'gray',
  idle: 'warning',
  moving: 'success',
  stopped: 'gray',
  open: 'danger',
  acknowledged: 'warning',
  resolved: 'success',
};

export interface StatusBadgeProps {
  kind: StatusKind;
  children: ReactNode;
  dot?: boolean;
  className?: string;
}

export function StatusBadge({ kind, children, dot = true, className }: StatusBadgeProps) {
  return (
    <Badge color={STATUS_COLOR[kind]} dot={dot} className={className}>
      {children}
    </Badge>
  );
}
