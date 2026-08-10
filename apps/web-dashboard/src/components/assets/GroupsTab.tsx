/**
 * GroupsTab — the vehicle-group registry (Fleet-Management §2 VehicleGroup).
 *
 * Renders groups as cards with member counts + type filter + status. Click a
 * card to open the group detail drawer; a per-card menu offers edit/delete.
 * v3 (CRUD): + Add + edit + delete wired via the shared AssetFormDrawer +
 * ConfirmDialog (managed by AssetManagementPage).
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { groupStatusColor } from '@/components/assets/asset-meta';
import type { VehicleGroup } from '@/types/asset.types';
import {
  Box,
  Card,
  CardActionArea,
  CardContent,
  Chip,
  IconButton,
  ListItemIcon,
  Menu,
  MenuItem,
  Skeleton,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import { Eye, MoreVertical, Pencil, Trash2, Users } from 'lucide-react';

interface GroupsTabProps {
  groups: VehicleGroup[];
  loading?: boolean;
  selectedId?: string | null;
  onSelect: (id: string) => void;
  onEdit?: (group: VehicleGroup) => void;
  onDelete?: (id: string, name: string) => void;
}

export function GroupsTab({
  groups,
  loading = false,
  selectedId,
  onSelect,
  onEdit,
  onDelete,
}: GroupsTabProps) {
  const { t } = useTranslation();
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [menuGroup, setMenuGroup] = useState<VehicleGroup | null>(null);
  const openMenu = (e: React.MouseEvent<HTMLElement>, g: VehicleGroup) => {
    setMenuGroup(g);
    setMenuAnchor(e.currentTarget);
  };
  const closeMenu = () => {
    setMenuAnchor(null);
    setMenuGroup(null);
  };

  if (loading) {
    return (
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
          gap: 1.5,
          p: 2,
        }}
      >
        {['gsk-a', 'gsk-b', 'gsk-c', 'gsk-d'].map((k) => (
          <Skeleton key={k} variant="rounded" height={110} />
        ))}
      </Box>
    );
  }

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
        gap: 1.5,
        p: 2,
      }}
    >
      {groups.map((g) => (
        <Card
          key={g.id}
          variant="outlined"
          sx={{
            borderColor: g.id === selectedId ? 'primary.main' : 'divider',
            borderWidth: g.id === selectedId ? 2 : 1,
            position: 'relative',
          }}
        >
          <CardActionArea onClick={() => onSelect(g.id)}>
            <CardContent>
              <Stack direction="row" alignItems="center" justifyContent="space-between" gap={1}>
                <Typography variant="subtitle1" sx={{ fontWeight: 600 }} noWrap>
                  {g.name}
                </Typography>
                <Chip
                  size="small"
                  label={t(`assets.group.status.${g.status}`)}
                  sx={{
                    height: 18,
                    fontSize: '0.65rem',
                    fontWeight: 600,
                    color: '#fff',
                    bgcolor: groupStatusColor(g.status),
                  }}
                />
              </Stack>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, minHeight: 32 }}>
                {g.description}
              </Typography>
              <Stack direction="row" gap={2} sx={{ mt: 1 }} alignItems="center">
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    {t('assets.group.members')}
                  </Typography>
                  <Typography variant="h6">{g.memberCount}</Typography>
                </Box>
                {g.vehicleTypeFilter && (
                  <Box>
                    <Typography variant="caption" color="text.secondary">
                      {t('assets.group.typeFilter')}
                    </Typography>
                    <Typography variant="body2">
                      {t(`assets.vehicle.type.${g.vehicleTypeFilter}`)}
                    </Typography>
                  </Box>
                )}
                <Box sx={{ flex: 1 }} />
                <IconButton
                  size="small"
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    openMenu(e, g);
                  }}
                  aria-label={t('common.actions')}
                >
                  <MoreVertical size={18} />
                </IconButton>
              </Stack>
            </CardContent>
          </CardActionArea>
        </Card>
      ))}
      {groups.length === 0 && (
        <Typography
          color="text.secondary"
          sx={{ py: 4, textAlign: 'center', gridColumn: '1 / -1' }}
        >
          {t('assets.empty')}
        </Typography>
      )}

      {/* Per-card action menu. Manage Members has no backend yet → disabled
          with a "pending backend" tooltip (per the task's no-fake rule). */}
      <Menu
        anchorEl={menuAnchor}
        open={Boolean(menuAnchor)}
        onClose={closeMenu}
        slotProps={{ paper: { sx: { minWidth: 200 } } }}
      >
        <MenuItem
          onClick={() => {
            if (menuGroup) onSelect(menuGroup.id);
            closeMenu();
          }}
        >
          <ListItemIcon>
            <Eye size={16} />
          </ListItemIcon>
          <Typography variant="body2">{t('common.view')}</Typography>
        </MenuItem>
        <MenuItem
          onClick={() => {
            if (menuGroup && onEdit) onEdit(menuGroup);
            closeMenu();
          }}
          disabled={!onEdit}
        >
          <ListItemIcon>
            <Pencil size={16} />
          </ListItemIcon>
          <Typography variant="body2">{t('common.edit')}</Typography>
        </MenuItem>
        <MenuItem
          onClick={() => {
            if (menuGroup && onDelete) onDelete(menuGroup.id, menuGroup.name);
            closeMenu();
          }}
          disabled={!onDelete}
          sx={{ color: 'error.main' }}
        >
          <ListItemIcon>
            <Trash2 size={16} />
          </ListItemIcon>
          <Typography variant="body2">{t('common.delete')}</Typography>
        </MenuItem>
        <MenuItem disabled>
          <ListItemIcon>
            <Users size={16} />
          </ListItemIcon>
          <Tooltip title={t('assets.actions.pendingBackend')} placement="right">
            <Typography variant="body2" sx={{ opacity: 0.5 }}>
              {t('common.manageMembers')}
            </Typography>
          </Tooltip>
        </MenuItem>
      </Menu>
    </Box>
  );
}
