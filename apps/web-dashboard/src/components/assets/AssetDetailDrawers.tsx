/**
 * Asset detail drawers — right slide-overs for the three REAL asset classes
 * (fleet / vehicle / device). One file holds all three because they share the
 * MUI Drawer slide-over pattern (UI_UX §0.6 selection → detail) and a common
 * meta-row helper. Each renders the full entity attributes from the real
 * hooks (useFleetDetail / useVehicleDetail / useDeviceDetail).
 *
 * The vehicle drawer additionally owns the vehicle↔device binding surface
 * (Sprint E §11): the bound-device list (GET /vehicles/:id/devices), an
 * assign flow over the unbound devices (vehicleId === null), and per-device
 * unbind — all gated by `device.write`; a 409 from a double-bind surfaces
 * visibly. The active drawer is selected by the current tab + selected id.
 */
import { Calendar, CircleSlash, Cpu, Link2, Link2Off, Smartphone, Truck } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  useBindDeviceToVehicle,
  useDeviceDetail,
  useFleetDetail,
  useUnbindDeviceFromVehicle,
  useVehicleDetail,
  useVehicleDevices,
} from '@/api/asset.api';
import { ConflictError, getApiErrorMessage } from '@/api/errors';
import { PermissionGate } from '@/auth/permissions';
import {
  deviceProtocolColor,
  deviceStatusColor,
  fleetStatusColor,
  vehicleStatusColor,
} from '@/components/assets/asset-meta';
import { ConfirmDialog } from '@/components/feedback/ConfirmDialog';
import { useToast } from '@/components/feedback/ToastProvider';
import { FormAlert } from '@/components/form/FormAlert';
import { StatusBadge } from '@/components/ui';
import type { AssetTab } from '@/pages/AssetManagementPage';
import type {
  BoundDevice,
  Device,
  DeviceRole,
  DeviceStatus,
  Fleet,
  Vehicle,
} from '@/types/asset.types';
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  Drawer,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Typography,
} from '@mui/material';

const DRAWER_WIDTH = 420;

interface AssetDetailDrawersProps {
  tab: AssetTab;
  selectedId: string | null;
  onClose: () => void;
  /** Registries for cross-resolution (fleet/vehicle names, unbound devices). */
  fleets: Fleet[];
  vehicles: Vehicle[];
  devices: Device[];
}

/** Dispatcher: renders the drawer matching the active tab. */
export function AssetDetailDrawers({
  tab,
  selectedId,
  onClose,
  fleets,
  vehicles,
  devices,
}: AssetDetailDrawersProps) {
  return (
    <>
      {tab === 'fleets' && (
        <FleetDetailDrawer fleetId={selectedId} onClose={onClose} vehicles={vehicles} />
      )}
      {tab === 'vehicles' && (
        <VehicleDetailDrawer
          vehicleId={selectedId}
          onClose={onClose}
          fleets={fleets}
          devices={devices}
        />
      )}
      {tab === 'devices' && (
        <DeviceDetailDrawer deviceId={selectedId} onClose={onClose} vehicles={vehicles} />
      )}
    </>
  );
}

/** Shared slide-over shell. */
function DetailShell({
  open,
  onClose,
  title,
  subtitle,
  badge,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      variant="temporary"
      sx={{ '& .MuiDrawer-paper': { width: DRAWER_WIDTH, maxWidth: '100vw' } }}
    >
      <Stack sx={{ height: '100%', overflowY: 'auto' }}>
        <Stack
          direction="row"
          alignItems="center"
          gap={1.5}
          sx={{
            p: 2,
            borderBottom: '1px solid',
            borderColor: 'divider',
            position: 'sticky',
            top: 0,
            bgcolor: 'background.paper',
            zIndex: 1,
          }}
        >
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }} noWrap>
              {title}
            </Typography>
            {subtitle && (
              <Typography variant="caption" color="text.secondary" noWrap>
                {subtitle}
              </Typography>
            )}
          </Box>
          {badge}
          <IconButton onClick={onClose} aria-label="close" size="small">
            ✕
          </IconButton>
        </Stack>
        {children}
      </Stack>
    </Drawer>
  );
}

/** Loading + not-found helper. */
function DrawerBody({
  loading,
  notFound,
  notFoundKey,
  children,
}: {
  loading: boolean;
  notFound: boolean;
  notFoundKey: string;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }
  if (notFound) {
    return (
      <Box sx={{ p: 4 }}>
        <Typography color="text.secondary">{t(notFoundKey)}</Typography>
      </Box>
    );
  }
  return <>{children}</>;
}

/** A labeled meta row. */
function MetaRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.5 }}>
      <Box sx={{ color: 'text.secondary', display: 'flex', width: 20 }}>{icon}</Box>
      <Typography variant="body2" sx={{ minWidth: 110, color: 'text.secondary' }}>
        {label}
      </Typography>
      <Typography variant="body2" sx={{ flex: 1 }} noWrap>
        {value}
      </Typography>
    </Box>
  );
}

/** ISO → local string ('—' when null). */
function isoToLocal(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleString() : '—';
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Box sx={{ mt: 2 }}>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ textTransform: 'uppercase', letterSpacing: 0.5 }}
      >
        {label}
      </Typography>
      <Box sx={{ mt: 0.5 }}>{children}</Box>
    </Box>
  );
}

// ── Fleet drawer ─────────────────────────────────────────────────────────────

function FleetDetailDrawer({
  fleetId,
  onClose,
  vehicles,
}: {
  fleetId: string | null;
  onClose: () => void;
  vehicles: Vehicle[];
}) {
  const { t } = useTranslation();
  const { data: fleet, isLoading } = useFleetDetail(fleetId);
  const open = Boolean(fleetId);
  const vehicleCount = useMemo(
    () => (fleet ? vehicles.filter((v) => v.fleetId === fleet.id).length : 0),
    [vehicles, fleet],
  );

  return (
    <DetailShell
      open={open}
      onClose={onClose}
      title={fleet?.name ?? ''}
      subtitle={fleet?.code}
      badge={
        fleet ? (
          <StatusBadge
            label={t(`assets.fleet.status.${fleet.status}`)}
            color={fleetStatusColor(fleet.status)}
            variant="solid"
          />
        ) : null
      }
    >
      <DrawerBody
        loading={isLoading}
        notFound={open && !isLoading && !fleet}
        notFoundKey="assets.fleet.notFound"
      >
        {fleet && (
          <Stack gap={2} sx={{ p: 2 }}>
            <Box>
              <MetaRow
                icon={<Truck size={16} />}
                label={t('assets.fleet.code')}
                value={fleet.code}
              />
              <MetaRow
                icon={<Truck size={16} />}
                label={t('assets.fleet.colVehicles')}
                value={t('assets.fleet.vehiclesCount', { count: vehicleCount })}
              />
              <MetaRow
                icon={<Truck size={16} />}
                label={t('assets.fleet.description')}
                value={fleet.description ?? '—'}
              />
            </Box>
            <Divider />
            <Section label={t('assets.fleet.updatedAt')}>
              <MetaRow
                icon={<Calendar size={16} />}
                label={t('assets.fleet.createdAt')}
                value={isoToLocal(fleet.createdAt)}
              />
              <MetaRow
                icon={<Calendar size={16} />}
                label={t('assets.fleet.updatedAt')}
                value={isoToLocal(fleet.updatedAt)}
              />
            </Section>
          </Stack>
        )}
      </DrawerBody>
    </DetailShell>
  );
}

// ── Vehicle drawer (incl. the device-binding surface, §11) ──────────────────

const ROLE_OPTIONS: DeviceRole[] = ['TRACKER', 'MDVR', 'CAN', 'SENSOR', 'OTHER'];

function VehicleDetailDrawer({
  vehicleId,
  onClose,
  fleets,
  devices,
}: {
  vehicleId: string | null;
  onClose: () => void;
  fleets: Fleet[];
  devices: Device[];
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const { data: vehicle, isLoading } = useVehicleDetail(vehicleId);
  const bound = useVehicleDevices(vehicleId);
  const bind = useBindDeviceToVehicle();
  const unbind = useUnbindDeviceFromVehicle();
  const open = Boolean(vehicleId);

  const [assignDeviceId, setAssignDeviceId] = useState('');
  const [assignRole, setAssignRole] = useState<DeviceRole>('TRACKER');
  const [bindError, setBindError] = useState<string | null>(null);
  const [unbindTarget, setUnbindTarget] = useState<BoundDevice | null>(null);

  const fleetName = useMemo(
    () => fleets.find((f) => f.id === vehicle?.fleetId)?.name ?? '—',
    [fleets, vehicle?.fleetId],
  );
  // Assignable devices: unbound (vehicleId === null) and not decommissioned.
  const unboundDevices = useMemo(
    () => devices.filter((d) => d.vehicleId === null && d.status !== 'DECOMMISSIONED'),
    [devices],
  );

  const onAssign = async () => {
    if (!vehicleId || !assignDeviceId) return;
    setBindError(null);
    try {
      await bind.mutateAsync({ vehicleId, deviceId: assignDeviceId, role: assignRole });
      toast.success(t('assets.crud.updateSuccess', { name: t('assets.device.devices') }));
      setAssignDeviceId('');
    } catch (err) {
      // 409 → the device is already bound elsewhere (or primary clash).
      setBindError(
        err instanceof ConflictError ? t('assets.device.alreadyBound') : getApiErrorMessage(err),
      );
    }
  };

  const onConfirmUnbind = async () => {
    if (!vehicleId || !unbindTarget) return;
    try {
      await unbind.mutateAsync({ vehicleId, deviceId: unbindTarget.deviceId });
      toast.success(t('assets.crud.updateSuccess', { name: t('assets.device.devices') }));
      setUnbindTarget(null);
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <>
      <DetailShell
        open={open}
        onClose={onClose}
        title={vehicle?.name ?? ''}
        subtitle={vehicle?.code}
        badge={
          vehicle ? (
            <StatusBadge
              label={t(`assets.vehicle.status.${vehicle.status}`)}
              color={vehicleStatusColor(vehicle.status)}
              variant="solid"
            />
          ) : null
        }
      >
        <DrawerBody
          loading={isLoading}
          notFound={open && !isLoading && !vehicle}
          notFoundKey="assets.vehicle.notFound"
        >
          {vehicle && (
            <Stack gap={2} sx={{ p: 2 }}>
              <Box>
                <MetaRow
                  icon={<Truck size={16} />}
                  label={t('assets.vehicle.fleet')}
                  value={fleetName}
                />
                <MetaRow
                  icon={<Truck size={16} />}
                  label={t('assets.vehicle.plate')}
                  value={vehicle.plate ?? '—'}
                />
                <MetaRow
                  icon={<Truck size={16} />}
                  label={t('assets.vehicle.vin')}
                  value={vehicle.vin ?? '—'}
                />
              </Box>

              <Divider />

              {/* Bound devices (GET /vehicles/:id/devices) */}
              <Section label={t('assets.device.devices')}>
                {bound.isLoading ? (
                  <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
                    <CircularProgress size={20} />
                  </Box>
                ) : (bound.data ?? []).length === 0 ? (
                  <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
                    {t('assets.device.unbound')}
                  </Typography>
                ) : (
                  <Stack gap={1}>
                    {(bound.data ?? []).map((d) => (
                      <Stack
                        key={d.deviceId}
                        direction="row"
                        alignItems="center"
                        gap={1}
                        sx={{
                          border: '1px solid',
                          borderColor: 'divider',
                          borderRadius: 1,
                          px: 1.5,
                          py: 1,
                        }}
                      >
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                          <Typography
                            variant="body2"
                            sx={{ fontFamily: 'monospace', fontWeight: 500 }}
                            noWrap
                          >
                            {d.imei}
                          </Typography>
                          <Typography variant="caption" color="text.secondary" noWrap>
                            {[d.manufacturer, d.model].filter(Boolean).join(' ') || '—'}
                          </Typography>
                        </Box>
                        <Chip
                          size="small"
                          label={t(`assets.device.roles.${d.role}`, { defaultValue: d.role })}
                          variant="outlined"
                        />
                        {d.isPrimary && (
                          <Chip size="small" label={t('assets.device.primary')} color="primary" />
                        )}
                        <StatusBadge
                          label={t(`assets.device.statusValues.${d.deviceStatus}`, {
                            defaultValue: d.deviceStatus,
                          })}
                          color={deviceStatusColor(d.deviceStatus as DeviceStatus)}
                        />
                        <PermissionGate requires="device.write">
                          <IconButton
                            size="small"
                            aria-label={t('assets.device.unassign')}
                            onClick={() => setUnbindTarget(d)}
                          >
                            <Link2Off size={16} />
                          </IconButton>
                        </PermissionGate>
                      </Stack>
                    ))}
                  </Stack>
                )}

                {/* Assign flow — gated by device.write. */}
                <PermissionGate requires="device.write">
                  <Stack gap={1.5} sx={{ mt: 1.5 }}>
                    <FormAlert severity="error" message={bindError} />
                    {unboundDevices.length === 0 ? (
                      <Typography variant="caption" color="text.secondary">
                        {t('assets.device.noUnbound')}
                      </Typography>
                    ) : (
                      <Stack direction="row" gap={1} sx={{ alignItems: 'flex-start' }}>
                        <FormControl size="small" sx={{ flex: 2, minWidth: 0 }}>
                          <InputLabel id="assign-device-label">
                            {t('assets.device.imei')}
                          </InputLabel>
                          <Select
                            labelId="assign-device-label"
                            label={t('assets.device.imei')}
                            value={assignDeviceId}
                            onChange={(e) => setAssignDeviceId(e.target.value)}
                            fullWidth
                          >
                            {unboundDevices.map((d) => (
                              <MenuItem key={d.id} value={d.id}>
                                <span style={{ fontFamily: 'monospace' }}>{d.imei}</span>
                                {d.model ? ` · ${d.model}` : ''}
                              </MenuItem>
                            ))}
                          </Select>
                        </FormControl>
                        <FormControl size="small" sx={{ flex: 1, minWidth: 0 }}>
                          <InputLabel id="assign-role-label">{t('assets.device.role')}</InputLabel>
                          <Select
                            labelId="assign-role-label"
                            label={t('assets.device.role')}
                            value={assignRole}
                            onChange={(e) => setAssignRole(e.target.value as DeviceRole)}
                            fullWidth
                          >
                            {ROLE_OPTIONS.map((r) => (
                              <MenuItem key={r} value={r}>
                                {t(`assets.device.roles.${r}`)}
                              </MenuItem>
                            ))}
                          </Select>
                        </FormControl>
                        <Button
                          size="small"
                          variant="contained"
                          startIcon={<Link2 size={14} />}
                          disabled={!assignDeviceId || bind.isPending}
                          onClick={onAssign}
                          sx={{ minWidth: 'auto', whiteSpace: 'nowrap' }}
                        >
                          {t('assets.device.assignAction')}
                        </Button>
                      </Stack>
                    )}
                  </Stack>
                </PermissionGate>
              </Section>

              <Divider />
              <Section label={t('assets.vehicle.updatedAt')}>
                <MetaRow
                  icon={<Calendar size={16} />}
                  label={t('assets.vehicle.createdAt')}
                  value={isoToLocal(vehicle.createdAt)}
                />
                <MetaRow
                  icon={<Calendar size={16} />}
                  label={t('assets.vehicle.updatedAt')}
                  value={isoToLocal(vehicle.updatedAt)}
                />
              </Section>
            </Stack>
          )}
        </DrawerBody>
      </DetailShell>

      {/* Unbind confirmation */}
      <ConfirmDialog
        open={unbindTarget !== null}
        title={t('assets.device.unassignConfirmTitle', { name: unbindTarget?.imei ?? '' })}
        message={t('assets.device.unassignConfirmBody')}
        confirmLabelKey="assets.device.unassign"
        loading={unbind.isPending}
        onConfirm={onConfirmUnbind}
        onClose={() => setUnbindTarget(null)}
      />
    </>
  );
}

// ── Device drawer ────────────────────────────────────────────────────────────

function DeviceDetailDrawer({
  deviceId,
  onClose,
  vehicles,
}: {
  deviceId: string | null;
  onClose: () => void;
  vehicles: Vehicle[];
}) {
  const { t } = useTranslation();
  const { data: device, isLoading } = useDeviceDetail(deviceId);
  const open = Boolean(deviceId);
  const vehicle = useMemo(
    () => (device?.vehicleId ? vehicles.find((v) => v.id === device.vehicleId) : undefined),
    [vehicles, device?.vehicleId],
  );

  return (
    <DetailShell
      open={open}
      onClose={onClose}
      title={device?.imei ?? ''}
      subtitle={device ? [device.manufacturer, device.model].filter(Boolean).join(' ') : undefined}
      badge={
        device ? (
          <StatusBadge
            label={t(`assets.device.statusValues.${device.status}`)}
            color={deviceStatusColor(device.status)}
            variant="solid"
          />
        ) : null
      }
    >
      <DrawerBody
        loading={isLoading}
        notFound={open && !isLoading && !device}
        notFoundKey="assets.device.notFound"
      >
        {device && (
          <Stack gap={2} sx={{ p: 2 }}>
            <Section label={t('assets.device.registry')}>
              <MetaRow
                icon={<Smartphone size={16} />}
                label={t('assets.device.imei')}
                value={<span style={{ fontFamily: 'monospace' }}>{device.imei}</span>}
              />
              <MetaRow
                icon={<Cpu size={16} />}
                label={t('assets.device.serial')}
                value={device.serialNumber ?? '—'}
              />
              <MetaRow
                icon={<Cpu size={16} />}
                label={t('assets.device.manufacturer')}
                value={device.manufacturer ?? '—'}
              />
              <MetaRow
                icon={<Cpu size={16} />}
                label={t('assets.device.model')}
                value={device.model ?? '—'}
              />
              <MetaRow
                icon={<Cpu size={16} />}
                label={t('assets.device.protocol')}
                value={
                  <StatusBadge
                    label={t(`assets.device.protocols.${device.protocol}`)}
                    color={deviceProtocolColor(device.protocol)}
                  />
                }
              />
              <MetaRow
                icon={<Truck size={16} />}
                label={t('assets.device.colVehicle')}
                value={device.vehicleId ? (vehicle?.name ?? device.vehicleId) : '—'}
              />
            </Section>

            <Divider />
            <Section label={t('assets.device.connection')}>
              <MetaRow
                icon={<CircleSlash size={16} />}
                label={t('assets.device.lastSeen')}
                value={isoToLocal(device.lastSeenAt)}
              />
              <MetaRow
                icon={<Link2 size={16} />}
                label={t('assets.device.connectedAt')}
                value={isoToLocal(device.connectedAt)}
              />
              <MetaRow
                icon={<Link2Off size={16} />}
                label={t('assets.device.disconnectedAt')}
                value={isoToLocal(device.disconnectedAt)}
              />
            </Section>

            <Divider />
            <Section label={t('assets.device.updatedAt')}>
              <MetaRow
                icon={<Calendar size={16} />}
                label={t('assets.device.createdAt')}
                value={isoToLocal(device.createdAt)}
              />
              <MetaRow
                icon={<Calendar size={16} />}
                label={t('assets.device.updatedAt')}
                value={isoToLocal(device.updatedAt)}
              />
            </Section>
          </Stack>
        )}
      </DrawerBody>
    </DetailShell>
  );
}
