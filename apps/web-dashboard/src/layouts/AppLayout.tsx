import {
  AppBar,
  Avatar,
  Box,
  Divider,
  Drawer,
  IconButton,
  InputBase,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Toolbar,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  BarChart3,
  Bell,
  CheckCircle,
  ChevronLeft,
  Fuel,
  HelpCircle,
  LayoutDashboard,
  LogOut,
  Map as MapIcon,
  Moon,
  Navigation,
  Search,
  Settings,
  Sun,
  Truck,
  Users,
  Video,
  UserCircle,
} from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Outlet, useLocation, useNavigate } from 'react-router';

import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { useAuth } from '@/hooks/useAuth';
import { useThemeContext } from '@/theme/ThemeRegistry';

/** Width of the side navigation in expanded state. */
const DRAWER_WIDTH = 240;

/** Width of the side navigation in collapsed state. */
const DRAWER_COLLAPSED_WIDTH = 72;

/** Navigation items mapped to routes and icons. */
const navItems = [
  { key: 'dashboard', path: '/dashboard', icon: <LayoutDashboard size={20} /> },
  { key: 'map', path: '/map', icon: <MapIcon size={20} /> },
  { key: 'vehicles', path: '/vehicles', icon: <Truck size={20} /> },
  { key: 'drivers', path: '/drivers', icon: <Users size={20} /> },
  { key: 'trips', path: '/trips', icon: <Navigation size={20} /> },
  { key: 'video', path: '/video', icon: <Video size={20} /> },
  { key: 'maintenance', path: '/maintenance', icon: <Settings size={20} /> },
  { key: 'compliance', path: '/compliance', icon: <CheckCircle size={20} /> },
  { key: 'fuel', path: '/fuel', icon: <Fuel size={20} /> },
  { key: 'reports', path: '/reports', icon: <BarChart3 size={20} /> },
] as const;

/**
 * AppLayout — authenticated shell with TopBar, SideNav, and main content.
 *
 * Follows the FleetVision Design System §0.4 and §8.1:
 * - TopBar (56px): logo, global search, alerts, user menu
 * - SideNav (240px, collapsible to 72px): navigation with icons
 * - Main content area with breadcrumbs and <Outlet />
 */
export function AppLayout() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();
  const { mode, toggleColorMode } = useThemeContext();

  const [drawerOpen, setDrawerOpen] = useState(true);
  const [userMenuAnchor, setUserMenuAnchor] = useState<HTMLElement | null>(null);

  const handleUserMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    setUserMenuAnchor(event.currentTarget);
  };

  const handleUserMenuClose = () => {
    setUserMenuAnchor(null);
  };

  const handleLogout = async () => {
    handleUserMenuClose();
    await logout();
    navigate('/login');
  };

  const handleProfile = () => {
    handleUserMenuClose();
    navigate('/account/profile');
  };

  const currentPath = location.pathname;

  return (
    <Box sx={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      {/* ── Side Navigation ── */}
      <Drawer
        variant="permanent"
        sx={{
          width: drawerOpen ? DRAWER_WIDTH : DRAWER_COLLAPSED_WIDTH,
          flexShrink: 0,
          transition: 'width 0.2s ease-in-out',
          '& .MuiDrawer-paper': {
            width: drawerOpen ? DRAWER_WIDTH : DRAWER_COLLAPSED_WIDTH,
            transition: 'width 0.2s ease-in-out',
            overflowX: 'hidden',
            borderRight: '1px solid',
            borderColor: 'divider',
          },
        }}
      >
        {/* Logo + collapse toggle */}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: drawerOpen ? 'space-between' : 'center',
            height: 56,
            px: 2,
          }}
        >
          {drawerOpen && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 32,
                  height: 32,
                  borderRadius: 2,
                  background: 'linear-gradient(135deg, #3B82F6 0%, #6366F1 100%)',
                  boxShadow: '0 4px 12px rgba(59,130,246,0.3)',
                  flexShrink: 0,
                }}
              >
                <Truck size={18} color="#fff" />
              </Box>
              <Typography
                variant="h6"
                sx={{
                  fontWeight: 800,
                  fontSize: '1rem',
                  letterSpacing: '-0.02em',
                  whiteSpace: 'nowrap',
                }}
              >
                FleetVision
              </Typography>
            </Box>
          )}
          <IconButton
            size="small"
            onClick={() => setDrawerOpen(!drawerOpen)}
            aria-label={drawerOpen ? 'Collapse navigation' : 'Expand navigation'}
          >
            <ChevronLeft
              size={20}
              style={{
                transform: drawerOpen ? 'rotate(0deg)' : 'rotate(180deg)',
                transition: 'transform 0.2s',
              }}
            />
          </IconButton>
        </Box>

        <Divider />

        {/* Navigation items */}
        <List sx={{ px: 1, py: 1 }}>
          {navItems.map((item) => {
            const isActive = currentPath.startsWith(item.path);
            return (
              <ListItem key={item.key} disablePadding sx={{ mb: 0.25 }}>
                <ListItemButton
                  selected={isActive}
                  onClick={() => navigate(item.path)}
                  sx={{
                    borderRadius: 2,
                    minHeight: 40,
                    justifyContent: drawerOpen ? 'initial' : 'center',
                    px: 2,
                  }}
                >
                  <ListItemIcon
                    sx={{
                      minWidth: 0,
                      mr: drawerOpen ? 1.5 : 0,
                      justifyContent: 'center',
                    }}
                  >
                    {item.icon}
                  </ListItemIcon>
                  {drawerOpen && (
                    <ListItemText
                      primary={t(`nav.${item.key}`)}
                      primaryTypographyProps={{
                        fontSize: '0.875rem',
                        fontWeight: isActive ? 500 : 400,
                        noWrap: true,
                      }}
                    />
                  )}
                </ListItemButton>
              </ListItem>
            );
          })}
        </List>
      </Drawer>

      {/* ── Main area ── */}
      <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, overflow: 'hidden' }}>
        {/* ── Top Bar (56px) ── */}
        <AppBar
          position="static"
          elevation={0}
          sx={{
            backgroundColor: 'background.paper',
            borderBottom: '1px solid',
            borderColor: 'divider',
            color: 'text.primary',
          }}
        >
          <Toolbar sx={{ height: 56, minHeight: '56px !important', px: 2 }}>
            {/* Global search */}
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                flex: 1,
                maxWidth: 480,
                backgroundColor: 'action.hover',
                borderRadius: 10,
                px: 1.5,
                py: 0.5,
                mx: 2,
                border: '1px solid',
                borderColor: 'divider',
                transition: 'all 0.2s ease',
                '&:focus-within': {
                  borderColor: 'primary.main',
                  boxShadow: '0 0 0 3px rgba(59,130,246,0.12)',
                },
              }}
            >
              <Search size={18} style={{ color: 'text.secondary', flexShrink: 0 }} />
              <InputBase
                placeholder={t('common.search')}
                sx={{
                  ml: 1.5,
                  flex: 1,
                  fontSize: '0.875rem',
                  color: 'text.primary',
                }}
                inputProps={{ 'aria-label': 'global search' }}
              />
            </Box>

            <Box sx={{ flex: 1 }} />

            {/* Right section */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Tooltip title={t('common.alerts')}>
                <IconButton size="small" aria-label="alerts" onClick={() => navigate('/alarms')}>
                  <Bell size={20} />
                </IconButton>
              </Tooltip>

              <Tooltip title={t('common.help')}>
                <IconButton size="small" aria-label="help">
                  <HelpCircle size={20} />
                </IconButton>
              </Tooltip>

              <Tooltip title={mode === 'light' ? t('common.darkMode') : t('common.lightMode')}>
                <IconButton size="small" onClick={toggleColorMode} aria-label="toggle theme">
                  {mode === 'light' ? <Moon size={20} /> : <Sun size={20} />}
                </IconButton>
              </Tooltip>

              <LanguageSwitcher />

              {/* User avatar menu */}
              <Tooltip title={user?.email ?? 'User'}>
                <IconButton size="small" onClick={handleUserMenuOpen} aria-label="user menu">
                  <Avatar sx={{ width: 32, height: 32, fontSize: '0.75rem' }}>
                    {user?.email?.charAt(0).toUpperCase() ?? 'U'}
                  </Avatar>
                </IconButton>
              </Tooltip>

              <Menu
                anchorEl={userMenuAnchor}
                open={Boolean(userMenuAnchor)}
                onClose={handleUserMenuClose}
                transformOrigin={{ horizontal: 'right', vertical: 'top' }}
                anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
                slotProps={{ paper: { sx: { mt: 0.5, minWidth: 180 } } }}
              >
                {user && (
                  <MenuItem disabled>
                    <Typography variant="body2" sx={{ fontWeight: 500 }}>
                      {user.email}
                    </Typography>
                  </MenuItem>
                )}
                <Divider />
                <MenuItem onClick={handleProfile}>
                  <ListItemIcon>
                    <UserCircle size={18} />
                  </ListItemIcon>
                  <Typography variant="body2">{t('common.profile')}</Typography>
                </MenuItem>
                <MenuItem onClick={handleLogout}>
                  <ListItemIcon>
                    <LogOut size={18} />
                  </ListItemIcon>
                  <Typography variant="body2">{t('common.logout')}</Typography>
                </MenuItem>
              </Menu>
            </Box>
          </Toolbar>
        </AppBar>

        {/* ── Main content ── */}
        <Box
          sx={{
            flex: 1,
            overflow: 'auto',
            backgroundColor: 'background.default',
            p: 3,
          }}
        >
          {/* Outlet renders the matched child route */}
          <Outlet />
        </Box>
      </Box>
    </Box>
  );
}
