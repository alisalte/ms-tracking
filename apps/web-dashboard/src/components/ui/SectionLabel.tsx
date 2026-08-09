import { Typography, type TypographyOwnProps } from '@mui/material';
import type { ReactNode } from 'react';

interface SectionLabelProps {
  children: ReactNode;
  /** The Limitless group-header label sits on a slightly darker strip. */
  onDark?: boolean;
  /** Optional sx passthrough. */
  sx?: TypographyOwnProps['sx'];
}

/**
 * SectionLabel — Limitless's uppercase 12px tracked group label.
 *
 * Used on the dark sidebar group headers (onDark) and as card/panel section
 * headings. Uppercase, 0.08em tracking, weight 700 (Limitless design language).
 */
export function SectionLabel({ children, onDark = false, sx }: SectionLabelProps) {
  return (
    <Typography
      variant="overline"
      component="span"
      sx={{
        lineHeight: 1.6667,
        color: onDark ? 'rgba(255,255,255,0.5)' : 'text.secondary',
        ...sx,
      }}
    >
      {children}
    </Typography>
  );
}
