import { Box, Stack, Typography } from '@mui/material';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

interface EmptyStateProps {
  /** Lucide icon. */
  icon?: LucideIcon;
  /** Title (already translated). */
  title: ReactNode;
  /** Description (already translated). */
  description?: ReactNode;
  /** Optional action (button, link). */
  action?: ReactNode;
  /** Vertical padding. */
  py?: number;
}

/**
 * EmptyState — Limitless-style empty placeholder (icon + title + description).
 *
 * Used by tables, lists, and panels when there is nothing to show.
 */
export function EmptyState({ icon: Icon, title, description, action, py = 6 }: EmptyStateProps) {
  return (
    <Stack
      alignItems="center"
      justifyContent="center"
      gap={1.5}
      sx={{ py, textAlign: 'center', width: '100%' }}
    >
      {Icon && (
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 56,
            height: 56,
            borderRadius: '50%',
            backgroundColor: 'action.hover',
            color: 'text.secondary',
          }}
        >
          <Icon size={26} />
        </Box>
      )}
      <Box sx={{ maxWidth: 400 }}>
        <Typography variant="subtitle1" fontWeight={600}>
          {title}
        </Typography>
        {description && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {description}
          </Typography>
        )}
      </Box>
      {action && <Box sx={{ mt: 1 }}>{action}</Box>}
    </Stack>
  );
}
