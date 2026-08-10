import { Stack, type StackOwnProps, Typography } from '@mui/material';
import type { ReactNode } from 'react';

import { Breadcrumb, type BreadcrumbItem } from './Breadcrumb';

interface PageHeaderProps extends StackOwnProps {
  /** Page title (already translated). */
  title: ReactNode;
  /** Optional subtitle (already translated). */
  subtitle?: ReactNode;
  /** Right-aligned actions (buttons, toggles). */
  actions?: ReactNode;
  /** Optional live badge next to the title. */
  live?: ReactNode;
  /** Breadcrumb trail (rendered above the title). */
  breadcrumb?: BreadcrumbItem[];
  /** Compact mode — smaller title + tighter spacing. */
  compact?: boolean;
}

/**
 * PageHeader — the Limitless page header: optional breadcrumb over a title +
 * subtitle row with right-aligned actions.
 *
 * Standardizes the page top across every FleetVision page so they share one
 * rhythm (UI_UX_Design.md §0.4 content header).
 */
export function PageHeader({
  title,
  subtitle,
  actions,
  live,
  breadcrumb,
  compact = false,
  ...stackProps
}: PageHeaderProps) {
  return (
    <Stack
      direction={{ xs: 'column', sm: 'row' }}
      alignItems={{ sm: 'center' }}
      justifyContent="space-between"
      gap={1.5}
      sx={{
        mb: compact ? 1 : 2,
        ...(breadcrumb ? { mt: 0.5 } : {}),
      }}
      {...stackProps}
    >
      <Stack gap={0.75} minWidth={0}>
        {breadcrumb && breadcrumb.length > 0 && <Breadcrumb items={breadcrumb} />}
        <Stack direction="row" alignItems="center" gap={1}>
          <Typography
            variant={compact ? 'h5' : 'h4'}
            component="h1"
            sx={{ fontWeight: 700, lineHeight: 1.2 }}
          >
            {title}
          </Typography>
          {live}
        </Stack>
        {subtitle && (
          <Typography variant="body2" color="text.secondary">
            {subtitle}
          </Typography>
        )}
      </Stack>
      {actions && (
        <Stack direction="row" alignItems="center" gap={1} flexWrap="wrap" sx={{ flexShrink: 0 }}>
          {actions}
        </Stack>
      )}
    </Stack>
  );
}
