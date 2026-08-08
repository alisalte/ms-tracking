/**
 * AdminNav — the left settings navigation (UI_UX §5.2 IA, §5.5 two-column shell).
 *
 * Renders the full 12-item Admin Panel IA. The keyword sections (users, roles,
 * permissions, settings, audit) are functional; the rest render an "upcoming"
 * placeholder so the IA reads complete. The active section is highlighted.
 */
import {
  Bell,
  Building2,
  CreditCard,
  KeyRound,
  Layers,
  Lock,
  MapPin,
  Plug,
  ScrollText,
  Settings,
  ShieldCheck,
  Truck,
  Users,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type { AdminSection } from '@/types/admin.types';
import {
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Typography,
} from '@mui/material';

/** Nav item definition — section key + icon + whether it's functional this sprint. */
interface NavItem {
  key: AdminSection;
  icon: typeof Users;
  enabled: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { key: 'organization', icon: Building2, enabled: false },
  { key: 'users', icon: Users, enabled: true },
  { key: 'roles', icon: Lock, enabled: true },
  { key: 'permissions', icon: ShieldCheck, enabled: true },
  { key: 'fleets', icon: Truck, enabled: false },
  { key: 'devices', icon: Layers, enabled: false },
  { key: 'geofences', icon: MapPin, enabled: false },
  { key: 'policies', icon: ShieldCheck, enabled: false },
  { key: 'notifications', icon: Bell, enabled: false },
  { key: 'integrations', icon: Plug, enabled: false },
  { key: 'apikeys', icon: KeyRound, enabled: false },
  { key: 'billing', icon: CreditCard, enabled: false },
  { key: 'audit', icon: ScrollText, enabled: true },
  { key: 'settings', icon: Settings, enabled: true },
];

interface AdminNavProps {
  section: AdminSection;
  onSelect: (s: AdminSection) => void;
}

export function AdminNav({ section, onSelect }: AdminNavProps) {
  const { t } = useTranslation();
  return (
    <List dense disablePadding>
      {NAV_ITEMS.map((item) => {
        const isActive = section === item.key;
        return (
          <ListItem key={item.key} disablePadding sx={{ mb: 0.25 }}>
            <ListItemButton
              selected={isActive}
              onClick={() => item.enabled && onSelect(item.key)}
              sx={{
                borderRadius: 1.5,
                minHeight: 38,
                px: 1.5,
                opacity: item.enabled ? 1 : 0.5,
                cursor: item.enabled ? 'pointer' : 'not-allowed',
                '&.Mui-selected': {
                  bgcolor: 'primary.main',
                  color: 'primary.contrastText',
                  '&:hover': { bgcolor: 'primary.dark' },
                  '& .MuiListItemIcon-root': { color: 'primary.contrastText' },
                },
              }}
            >
              <ListItemIcon sx={{ minWidth: 32, justifyContent: 'center' }}>
                <item.icon size={18} />
              </ListItemIcon>
              <ListItemText
                primary={t(`admin.nav.${item.key}`)}
                primaryTypographyProps={{ fontSize: '0.85rem', fontWeight: isActive ? 600 : 400 }}
              />
              {!item.enabled && (
                <Typography variant="caption" color="text.disabled" sx={{ fontSize: '0.6rem' }}>
                  {t('admin.upcoming')}
                </Typography>
              )}
            </ListItemButton>
          </ListItem>
        );
      })}
    </List>
  );
}
