import { Box, Button, Stack, Typography } from '@mui/material';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

interface EmptyStateProps {
  /** i18n key for the headline. */
  titleKey: string;
  /** i18n key for the supporting copy explaining why + what to do next. */
  descriptionKey?: string;
  /** Illustration icon (lucide). */
  icon?: LucideIcon;
  /** Optional CTA label key + handler (UI_UX_Design.md §8.11). */
  actionLabelKey?: string;
  onAction?: () => void;
  /** Inline variant — smaller, for use inside a widget body. */
  variant?: 'inline' | 'standalone';
  children?: ReactNode;
}

/**
 * EmptyState — never a blank page (UI_UX_Design.md §0.6, §8.11).
 *
 * Illustration + headline + supporting copy + (optional) CTA. Used for new-tenant
 * empty states and any widget that legitimately has nothing to show.
 */
export function EmptyState({
  titleKey,
  descriptionKey,
  icon: Icon,
  actionLabelKey,
  onAction,
  variant = 'inline',
  children,
}: EmptyStateProps) {
  const standalone = variant === 'standalone';
  return (
    <Stack
      alignItems="center"
      justifyContent="center"
      textAlign="center"
      gap={1.5}
      sx={{
        py: standalone ? 6 : 3,
        px: 2,
        width: '100%',
      }}
    >
      {Icon && (
        <Box
          sx={{
            width: standalone ? 56 : 40,
            height: standalone ? 56 : 40,
            borderRadius: '50%',
            backgroundColor: 'action.hover',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'text.secondary',
          }}
        >
          <Icon size={standalone ? 26 : 20} />
        </Box>
      )}
      <Box>
        <Typography
          variant={standalone ? 'h5' : 'subtitle2'}
          fontWeight={600}
          gutterBottom={Boolean(descriptionKey)}
        >
          {/* titleKey is rendered by the caller via t() in most usages; but for
              consistency we accept a pre-translated string too. We expect the key. */}
          {titleKey}
        </Typography>
        {descriptionKey && (
          <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 420, mx: 'auto' }}>
            {descriptionKey}
          </Typography>
        )}
      </Box>
      {children}
      {actionLabelKey && onAction && (
        <Button variant="contained" size="small" onClick={onAction} sx={{ mt: 0.5 }}>
          {actionLabelKey}
        </Button>
      )}
    </Stack>
  );
}
