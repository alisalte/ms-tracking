import { Box, InputBase, type SxProps, type Theme } from '@mui/material';
import { Search } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

interface ToolbarProps {
  /** Left-aligned controls (filters, selects). */
  left?: ReactNode;
  /** Right-aligned controls (count, actions). */
  right?: ReactNode;
  /** Show a built-in search input on the left. */
  search?: boolean;
  /** Controlled search value (when using the built-in search). */
  searchValue?: string;
  /** Search change handler. */
  onSearchChange?: (value: string) => void;
  /** Search placeholder key. */
  searchPlaceholderKey?: string;
  children?: ReactNode;
  /** Optional sx passthrough. */
  sx?: SxProps<Theme>;
}

/**
 * Toolbar — a Limitless-style filter/action row.
 *
 * A horizontally-aligned strip of controls that sits above tables and lists.
 * Renders an optional built-in search input on the left, then `left` controls,
 * a flexible spacer, then `right` controls. RTL-safe via flexbox.
 */
export function Toolbar({
  left,
  right,
  search = false,
  searchValue,
  onSearchChange,
  searchPlaceholderKey = 'common.search',
  children,
  sx,
}: ToolbarProps) {
  const { t } = useTranslation();
  const searchInput = (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.5,
        px: 1,
        py: 0.25,
        borderRadius: 3,
        border: '1px solid',
        borderColor: 'divider',
        backgroundColor: 'background.paper',
        minWidth: 200,
        maxWidth: 360,
        flex: 1,
        transition: 'all 0.15s ease-in-out',
        '&:focus-within': {
          borderColor: 'primary.main',
          boxShadow: '0 0 0 2px rgba(33,150,243,0.14)',
        },
      }}
    >
      <Search size={15} style={{ color: 'var(--mui-palette-text-secondary)', flexShrink: 0 }} />
      <InputBase
        value={searchValue}
        onChange={(e) => onSearchChange?.(e.target.value)}
        placeholder={t(searchPlaceholderKey)}
        sx={{ flex: 1, fontSize: '0.8125rem', minWidth: 0 }}
        inputProps={{ 'aria-label': 'search' }}
      />
    </Box>
  );

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        flexWrap: 'wrap',
        px: 2,
        py: 1.5,
        borderBottom: '1px solid',
        borderColor: 'divider',
        backgroundColor: 'background.paper',
        ...(sx as object),
      }}
    >
      {search && searchInput}
      {left}
      {children}
      <Box sx={{ flex: 1 }} />
      {right}
    </Box>
  );
}
