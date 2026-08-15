/**
 * NotificationBell — the notification center dropdown in the Topbar.
 *
 * Renders a bell icon with a live unread-count badge. Clicking opens a Popover
 * with the latest notifications, each with a mark-as-read action. Includes a
 * "mark all as read" button. Real-time updates arrive via the WS hook.
 */
import { Bell, CheckCheck } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import {
  useMarkAllAsRead,
  useMarkAsRead,
  useNotifications,
  useUnreadCount,
} from '@/api/notification.api';
import {
  Badge,
  Box,
  Button,
  CircularProgress,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Popover,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';

export function NotificationBell() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [anchorEl, setAnchorEl] = useState<HTMLButtonElement | null>(null);

  const { data: count } = useUnreadCount();
  const { data: notifications, isLoading } = useNotifications();
  const markAsRead = useMarkAsRead();
  const markAllAsRead = useMarkAllAsRead();

  const unread = count?.total ?? 0;
  const items = notifications ?? [];

  return (
    <>
      <Tooltip title={t('common.alerts', { defaultValue: 'Notifications' })}>
        <IconButton
          size="small"
          aria-label="notifications"
          onClick={(e) => setAnchorEl(e.currentTarget)}
        >
          <Badge badgeContent={unread > 0 ? unread : undefined} color="error">
            <Bell size={19} />
          </Badge>
        </IconButton>
      </Tooltip>

      <Popover
        open={Boolean(anchorEl)}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        PaperProps={{ sx: { width: 360, maxHeight: 480 } }}
      >
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ p: 1.5 }}>
          <Typography variant="subtitle2" fontWeight={700}>
            {t('notifications.title', { defaultValue: 'Notifications' })}
            {unread > 0 && <Badge badgeContent={unread} color="error" sx={{ ml: 1 }} />}
          </Typography>
          {unread > 0 && (
            <Button
              size="small"
              startIcon={<CheckCheck size={14} />}
              onClick={() => markAllAsRead.mutate()}
              disabled={markAllAsRead.isPending}
            >
              {t('notifications.markAllRead', { defaultValue: 'Mark all read' })}
            </Button>
          )}
        </Stack>

        {isLoading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
            <CircularProgress size={24} />
          </Box>
        ) : items.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 3 }}>
            {t('notifications.empty', { defaultValue: 'No notifications' })}
          </Typography>
        ) : (
          <List dense sx={{ maxHeight: 360, overflowY: 'auto' }}>
            {items.slice(0, 10).map((n) => (
              <ListItem
                key={n.id}
                sx={{
                  bgcolor: n.read ? 'transparent' : 'action.hover',
                  cursor: 'pointer',
                  '&:hover': { bgcolor: 'action.selected' },
                }}
                onClick={() => {
                  if (!n.read) markAsRead.mutate(n.id);
                  if (n.link) navigate(n.link);
                  setAnchorEl(null);
                }}
              >
                <ListItemText
                  primary={
                    <Stack direction="row" alignItems="center" gap={0.5}>
                      {!n.read && (
                        <Box
                          component="span"
                          sx={{
                            width: 6,
                            height: 6,
                            borderRadius: '50%',
                            bgcolor: n.severity === 'critical' ? 'error.main' : 'primary.main',
                            flexShrink: 0,
                          }}
                        />
                      )}
                      <Typography variant="body2" fontWeight={n.read ? 400 : 600} noWrap>
                        {n.title}
                      </Typography>
                    </Stack>
                  }
                  secondary={
                    <Typography variant="caption" color="text.secondary" noWrap>
                      {n.body}
                    </Typography>
                  }
                />
              </ListItem>
            ))}
          </List>
        )}
      </Popover>
    </>
  );
}
