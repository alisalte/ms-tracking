import {
  Avatar,
  Box,
  Divider,
  IconButton,
  InputBase,
  ListItemIcon,
  Menu,
  MenuItem,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import { HelpCircle, LogOut, Menu as MenuIcon, Moon, Search, Sun, UserCircle } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { NotificationBell } from '@/components/shell/NotificationBell';
import { useAuth } from '@/hooks/useAuth';
import { useThemeContext } from '@/theme/ThemeRegistry';

interface TopbarProps {
  /** Hamburger toggles the mobile sidebar. */
  onMobileMenu: () => void;
}

/**
 * Topbar — the Limitless Layout 1 top navbar (~50px).
 *
 * Light in light mode (the recognizable Limitless silhouette), adapts to dark.
 * Contains: mobile hamburger + global pill search (left), notifications bell
 * with count badge, help, theme toggle, language switcher, user dropdown
 * (right). The logo lives in the sidebar per Limitless L1.
 */
export function Topbar({ onMobileMenu }: TopbarProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { mode, toggleColorMode } = useThemeContext();
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);

  const handleLogout = async () => {
    setMenuAnchor(null);
    await logout();
    navigate('/login');
  };

  return (
    <Stack
      component="header"
      direction="row"
      alignItems="center"
      spacing={1}
      sx={{
        height: 50,
        px: 1.5,
        backgroundColor: 'background.paper',
        borderBottom: '1px solid',
        borderColor: 'divider',
        color: 'text.primary',
        flexShrink: 0,
      }}
    >
      {/* Mobile hamburger */}
      <IconButton
        onClick={onMobileMenu}
        aria-label={t('common.openMenu')}
        sx={{ display: { xs: 'inline-flex', lg: 'none' } }}
      >
        <MenuIcon size={20} />
      </IconButton>

      {/* Global pill search */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.75,
          height: 34,
          maxWidth: 420,
          flex: 1,
          px: 1.25,
          borderRadius: 3,
          border: '1px solid',
          borderColor: 'divider',
          backgroundColor: 'action.hover',
          transition: 'all 0.15s ease-in-out',
          '&:focus-within': {
            borderColor: 'primary.main',
            backgroundColor: 'background.paper',
            boxShadow: '0 0 0 2px rgba(33,150,243,0.14)',
          },
        }}
      >
        <Search size={16} style={{ color: 'var(--mui-palette-text-secondary)', flexShrink: 0 }} />
        <InputBase
          placeholder={t('common.search')}
          sx={{ flex: 1, fontSize: '0.8125rem', minWidth: 0 }}
          inputProps={{ 'aria-label': 'global search' }}
        />
      </Box>

      <Box sx={{ flex: 1 }} />

      {/* Right cluster */}
      <Stack direction="row" alignItems="center" spacing={0.25}>
        {/* Sprint H — real notification bell (live unread badge + dropdown). */}
        <NotificationBell />

        <Tooltip title={t('common.help')}>
          <IconButton size="small" aria-label={t('common.help')}>
            <HelpCircle size={19} />
          </IconButton>
        </Tooltip>

        <Tooltip title={mode === 'light' ? t('common.darkMode') : t('common.lightMode')}>
          <IconButton size="small" onClick={toggleColorMode} aria-label="toggle theme">
            {mode === 'light' ? <Moon size={19} /> : <Sun size={19} />}
          </IconButton>
        </Tooltip>

        <LanguageSwitcher />

        <Tooltip title={user?.email ?? 'User'}>
          <IconButton
            size="small"
            onClick={(e) => setMenuAnchor(e.currentTarget)}
            aria-label="user menu"
            sx={{ ml: 0.5 }}
          >
            <Avatar
              sx={{
                width: 30,
                height: 30,
                fontSize: '0.75rem',
                bgcolor: 'primary.main',
                color: 'primary.contrastText',
              }}
            >
              {user?.email?.charAt(0).toUpperCase() ?? 'U'}
            </Avatar>
          </IconButton>
        </Tooltip>

        <Menu
          anchorEl={menuAnchor}
          open={Boolean(menuAnchor)}
          onClose={() => setMenuAnchor(null)}
          transformOrigin={{ horizontal: 'right', vertical: 'top' }}
          anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
          slotProps={{ paper: { sx: { mt: 0.5, minWidth: 200 } } }}
        >
          {user && (
            <MenuItem disabled sx={{ opacity: 1 }}>
              <Stack>
                <Typography variant="body2" fontWeight={600}>
                  {user.email || '—'}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {user.tenantId}
                </Typography>
              </Stack>
            </MenuItem>
          )}
          <Divider />
          <MenuItem
            onClick={() => {
              setMenuAnchor(null);
              navigate('/account/profile');
            }}
          >
            <ListItemIcon>
              <UserCircle size={17} />
            </ListItemIcon>
            <Typography variant="body2">{t('common.profile')}</Typography>
          </MenuItem>
          <MenuItem onClick={handleLogout}>
            <ListItemIcon>
              <LogOut size={17} />
            </ListItemIcon>
            <Typography variant="body2">{t('common.logout')}</Typography>
          </MenuItem>
        </Menu>
      </Stack>
    </Stack>
  );
}
