/**
 * DevicesTab — the telematics device registry table.
 *
 * Filterable by status/type + free-text search. Shows device-health indicators
 * (battery, signal, last heartbeat) and the bound vehicle. Row click opens the
 * device detail drawer. Mirrors the Admin Panel Devices surface (UI_UX §5.4).
 */
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { SkeletonRows } from '@/components/assets/VehiclesTab';
import {
  batteryMeta,
  deviceStatusColor,
  deviceTypeIcon,
  signalColor,
} from '@/components/assets/asset-meta';
import { StatusBadge, Toolbar } from '@/components/ui';
import type { Device, DeviceStatus, DeviceType } from '@/types/asset.types';
import {
  Box,
  IconButton,
  ListItemIcon,
  Menu,
  MenuItem,
  Select,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material';
import { Eye, MoreVertical, Pencil, Settings, TerminalSquare, Trash2 } from 'lucide-react';

interface DevicesTabProps {
  devices: Device[];
  loading?: boolean;
  selectedId?: string | null;
  onSelect: (id: string) => void;
  filterStatus: DeviceStatus | 'all';
  filterType: DeviceType | 'all';
  query: string;
  onFilterStatus: (s: DeviceStatus | 'all') => void;
  onFilterType: (t: DeviceType | 'all') => void;
  onQuery: (q: string) => void;
  onEdit?: (device: Device) => void;
  onDelete?: (id: string, name: string) => void;
}

const STATUSES: Array<DeviceStatus | 'all'> = [
  'all',
  'active',
  'provisioned',
  'inactive',
  'firmware_updating',
  'faulted',
  'decommissioned',
];
const TYPES: Array<DeviceType | 'all'> = ['all', 'obd2', 'gps_tracker', 'dashcam', 'custom_sensor'];

export function DevicesTab({
  devices,
  loading = false,
  selectedId,
  onSelect,
  filterStatus,
  filterType,
  query,
  onFilterStatus,
  onFilterType,
  onQuery,
  onEdit,
  onDelete,
}: DevicesTabProps) {
  const { t } = useTranslation();
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [menuDevice, setMenuDevice] = useState<Device | null>(null);
  const openMenu = (e: React.MouseEvent<HTMLElement>, d: Device) => {
    setMenuDevice(d);
    setMenuAnchor(e.currentTarget);
  };
  const closeMenu = () => {
    setMenuAnchor(null);
    setMenuDevice(null);
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return devices.filter((d) => {
      if (filterStatus !== 'all' && d.status !== filterStatus) return false;
      if (filterType !== 'all' && d.deviceType !== filterType) return false;
      if (!q) return true;
      return (
        d.serialNumber.toLowerCase().includes(q) ||
        (d.imei?.toLowerCase().includes(q) ?? false) ||
        (d.boundVehicleLabel?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [devices, filterStatus, filterType, query]);

  if (loading) return <SkeletonRows cols={5} />;

  return (
    <Box>
      <Toolbar
        search
        searchValue={query}
        onSearchChange={onQuery}
        searchPlaceholderKey="assets.device.search"
        left={
          <>
            <Select
              size="small"
              value={filterStatus}
              onChange={(e) => onFilterStatus(e.target.value as DeviceStatus | 'all')}
              sx={{ height: 32, minWidth: 150, fontSize: '0.8rem' }}
            >
              {STATUSES.map((s) => (
                <MenuItem key={s} value={s}>
                  {s === 'all' ? t('assets.filters.allStatus') : t(`assets.device.status.${s}`)}
                </MenuItem>
              ))}
            </Select>
            <Select
              size="small"
              value={filterType}
              onChange={(e) => onFilterType(e.target.value as DeviceType | 'all')}
              sx={{ height: 32, minWidth: 140, fontSize: '0.8rem' }}
            >
              {TYPES.map((ty) => (
                <MenuItem key={ty} value={ty}>
                  {ty === 'all' ? t('assets.filters.allTypes') : t(`assets.device.type.${ty}`)}
                </MenuItem>
              ))}
            </Select>
          </>
        }
        right={
          <Typography variant="caption" color="text.secondary">
            {t('assets.count', { count: filtered.length })}
          </Typography>
        }
      />
      <TableContainer sx={{ maxHeight: 'calc(100vh - 280px)' }}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              <TableCell>{t('assets.device.colSerial')}</TableCell>
              <TableCell>{t('assets.device.colType')}</TableCell>
              <TableCell>{t('assets.device.colVehicle')}</TableCell>
              <TableCell>{t('assets.device.colStatus')}</TableCell>
              <TableCell>{t('assets.device.colHealth')}</TableCell>
              <TableCell align="right">{t('common.actions')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filtered.map((d) => {
              const TypeIcon = deviceTypeIcon(d.deviceType);
              const batt = batteryMeta(d.batteryLevel);
              const BattIcon = batt?.icon;
              return (
                <TableRow
                  key={d.id}
                  hover
                  selected={d.id === selectedId}
                  sx={{ cursor: 'pointer' }}
                >
                  <TableCell onClick={() => onSelect(d.id)}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <TypeIcon size={16} />
                      <Box>
                        <Typography
                          variant="body2"
                          sx={{ fontFamily: 'monospace', fontWeight: 500 }}
                        >
                          {d.serialNumber}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {d.manufacturer} {d.model}
                        </Typography>
                      </Box>
                    </Box>
                  </TableCell>
                  <TableCell onClick={() => onSelect(d.id)}>
                    <Typography variant="body2">
                      {t(`assets.device.type.${d.deviceType}`)}
                    </Typography>
                  </TableCell>
                  <TableCell onClick={() => onSelect(d.id)}>
                    <Typography variant="body2">{d.boundVehicleLabel ?? '—'}</Typography>
                  </TableCell>
                  <TableCell onClick={() => onSelect(d.id)}>
                    <StatusBadge
                      label={t(`assets.device.status.${d.status}`)}
                      color={deviceStatusColor(d.status)}
                      variant="solid"
                    />
                  </TableCell>
                  <TableCell onClick={() => onSelect(d.id)}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                      {BattIcon && (
                        <Box
                          sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}
                          title={`${d.batteryLevel}%`}
                        >
                          <BattIcon size={14} color={batt?.color} />
                          <Typography variant="caption" color="text.secondary">
                            {d.batteryLevel}%
                          </Typography>
                        </Box>
                      )}
                      {d.signalStrengthDbm !== undefined && (
                        <Typography
                          variant="caption"
                          sx={{ color: signalColor(d.signalStrengthDbm) }}
                        >
                          {d.signalStrengthDbm} dBm
                        </Typography>
                      )}
                      {d.lastHeartbeatAt && (
                        <Typography variant="caption" color="text.secondary">
                          {rel(d.lastHeartbeatAt)}
                        </Typography>
                      )}
                    </Box>
                  </TableCell>
                  <TableCell align="right" sx={{ pr: 1 }}>
                    <IconButton size="small" onClick={(e) => { e.stopPropagation(); openMenu(e, d); }} aria-label={t('common.actions')}>
                      <MoreVertical size={18} />
                    </IconButton>
                  </TableCell>
                </TableRow>
              );
            })}
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={6}>
                  <Typography color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
                    {t('assets.empty')}
                  </Typography>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Per-row action menu. Configure / Send Command have no backend yet →
          disabled with a "pending backend" tooltip (per the task's no-fake rule). */}
      <Menu
        anchorEl={menuAnchor}
        open={Boolean(menuAnchor)}
        onClose={closeMenu}
        slotProps={{ paper: { sx: { minWidth: 200 } } }}
      >
        <MenuItem onClick={() => { if (menuDevice) onSelect(menuDevice.id); closeMenu(); }}>
          <ListItemIcon><Eye size={16} /></ListItemIcon>
          <Typography variant="body2">{t('common.view')}</Typography>
        </MenuItem>
        <MenuItem
          onClick={() => { if (menuDevice && onEdit) onEdit(menuDevice); closeMenu(); }}
          disabled={!onEdit}
        >
          <ListItemIcon><Pencil size={16} /></ListItemIcon>
          <Typography variant="body2">{t('common.edit')}</Typography>
        </MenuItem>
        <MenuItem
          onClick={() => {
            if (menuDevice && onDelete) onDelete(menuDevice.id, menuDevice.serialNumber);
            closeMenu();
          }}
          disabled={!onDelete}
          sx={{ color: 'error.main' }}
        >
          <ListItemIcon><Trash2 size={16} /></ListItemIcon>
          <Typography variant="body2">{t('common.delete')}</Typography>
        </MenuItem>
        <MenuItem disabled>
          <ListItemIcon><Settings size={16} /></ListItemIcon>
          <Tooltip title={t('assets.actions.pendingBackend')} placement="right">
            <Typography variant="body2" sx={{ opacity: 0.5 }}>{t('common.configure')}</Typography>
          </Tooltip>
        </MenuItem>
        <MenuItem disabled>
          <ListItemIcon><TerminalSquare size={16} /></ListItemIcon>
          <Tooltip title={t('assets.actions.pendingBackend')} placement="right">
            <Typography variant="body2" sx={{ opacity: 0.5 }}>{t('common.sendCommand')}</Typography>
          </Tooltip>
        </MenuItem>
      </Menu>
    </Box>
  );
}

/** Compact relative time for the heartbeat column. */
function rel(iso: string): string {
  const min = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (min < 1) return 'now';
  if (min < 60) return `${min}m`;
  return `${Math.round(min / 60)}h`;
}
