import { Chip, type ChipOwnProps } from '@mui/material';

/** Semantic tone → fills used when no explicit color is given. */
export type BadgeTone =
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'neutral'
  | 'primary'
  | 'secondary';

interface StatusBadgeProps {
  /** Already-translated label. */
  label: string;
  /** Raw hex color (overrides tone) — lets us wrap existing `*StatusColor` maps. */
  color?: string;
  /** Semantic tone (used when `color` is not provided). */
  tone?: BadgeTone;
  /** Visual style: solid fill, soft tinted background, or outlined. */
  variant?: 'solid' | 'soft' | 'outlined';
  size?: 'small' | 'medium';
  /** Optional leading icon. */
  icon?: ChipOwnProps['icon'];
  /** Clickable — renders as an actionable chip. */
  onClick?: () => void;
  /** Whether this badge represents the active selection. */
  active?: boolean;
}

/** Solid foreground/background pair per tone. */
const SOLID: Record<BadgeTone, { bg: string; fg: string }> = {
  success: { bg: '#4CAF50', fg: '#fff' },
  warning: { bg: '#FF9800', fg: '#1A0E00' },
  danger: { bg: '#F44336', fg: '#fff' },
  info: { bg: '#00BCD4', fg: '#02191F' },
  primary: { bg: '#2196F3', fg: '#fff' },
  secondary: { bg: '#3F51B5', fg: '#fff' },
  neutral: { bg: '#90A4AE', fg: '#1A2228' },
};

/** Soft tinted background per tone (Limitless alpha style). */
const SOFT: Record<BadgeTone, { bg: string; fg: string; border: string }> = {
  success: { bg: 'rgba(76,175,80,0.14)', fg: '#2E7D32', border: 'rgba(76,175,80,0.30)' },
  warning: { bg: 'rgba(255,152,0,0.16)', fg: '#E65100', border: 'rgba(255,152,0,0.30)' },
  danger: { bg: 'rgba(244,67,54,0.14)', fg: '#C62828', border: 'rgba(244,67,54,0.30)' },
  info: { bg: 'rgba(0,188,212,0.14)', fg: '#0097A7', border: 'rgba(0,188,212,0.30)' },
  primary: { bg: 'rgba(33,150,243,0.14)', fg: '#1565C0', border: 'rgba(33,150,243,0.30)' },
  secondary: { bg: 'rgba(63,81,181,0.14)', fg: '#303F9F', border: 'rgba(63,81,181,0.30)' },
  neutral: { bg: 'rgba(96,125,139,0.16)', fg: '#455A64', border: 'rgba(96,125,139,0.30)' },
};

/**
 * StatusBadge — one unified pill badge for statuses/severities.
 *
 * Limitless badges are rounded pills with three presentation styles: solid
 * (filled), soft (tinted background — the Limitless alpha look), and outlined.
 * Wraps the existing `vehicleStatusColor` / `userStatusColor` / etc. maps by
 * accepting a raw `color` (hex) so the whole app uses one component without
 * rewriting every color map.
 */
export function StatusBadge({
  label,
  color,
  tone = 'neutral',
  variant = 'soft',
  size = 'small',
  icon,
  onClick,
  active,
}: StatusBadgeProps) {
  const height = size === 'small' ? 20 : 26;
  const fontSize = size === 'small' ? '0.6875rem' : '0.75rem';

  const sx = color
    ? // Raw color → derive solid/soft/outlined from the single hue.
      variant === 'solid'
        ? { bgcolor: color, color: '#fff', border: 'transparent' }
        : variant === 'outlined'
          ? { bgcolor: 'transparent', color, borderColor: color }
          : { bgcolor: `${color}1F`, color, borderColor: `${color}4D` }
    : variant === 'solid'
      ? { bgcolor: SOLID[tone].bg, color: SOLID[tone].fg, border: 'transparent' }
      : variant === 'outlined'
        ? {
            bgcolor: 'transparent',
            color: SOFT[tone].fg,
            borderColor: SOFT[tone].border,
          }
        : { bgcolor: SOFT[tone].bg, color: SOFT[tone].fg, borderColor: SOFT[tone].border };

  return (
    <Chip
      label={label}
      icon={icon}
      size={size}
      onClick={onClick}
      clickable={Boolean(onClick)}
      variant={onClick ? (active ? 'filled' : 'outlined') : undefined}
      sx={{
        height,
        minHeight: height,
        fontSize,
        fontWeight: 600,
        textTransform: 'none',
        borderWidth: 1,
        borderStyle: 'solid',
        cursor: onClick ? 'pointer' : 'default',
        '& .MuiChip-icon': { color: 'inherit', marginInline: '4px -2px' },
        '&:focus': { boxShadow: 'none' },
        ...(onClick && active ? { bgcolor: '#2196F3', color: '#fff', borderColor: '#2196F3' } : {}),
        ...sx,
      }}
    />
  );
}
