/**
 * Asset detail drawers — slide-overs for the three REAL asset classes
 * (fleet / vehicle / device). One file holds all three because they share the
 * slide-over pattern (UI_UX §0.6 selection → detail) and common meta-row
 * helpers. Each renders the full entity attributes from the real hooks
 * (useFleetDetail / useVehicleDetail / useDeviceDetail).
 *
 * The vehicle drawer additionally owns the vehicle↔device binding surface
 * (Sprint E §11): the bound-device list (GET /vehicles/:id/devices), an
 * assign flow over the unbound devices (vehicleId === null), and per-device
 * unbind — all gated by `device.write`; a 409 from a double-bind surfaces
 * visibly. The active drawer is selected by the current tab + selected id.
 */
import {
  Calendar,
  CircleSlash,
  Clock,
  Cpu,
  Gauge,
  IdCard,
  Link2,
  Link2Off,
  Phone,
  Smartphone,
  Truck,
  UserRound,
} from 'lucide-react';
import { type ReactNode, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  useBindDeviceToVehicle,
  useDeviceDetail,
  useFleetDetail,
  useUnbindDeviceFromVehicle,
  useVehicleDetail,
  useVehicleDevices,
} from '@/api/asset.api';
import {
  driverFullName,
  useAssignDriverVehicle,
  useDriverDetail,
  useUnassignDriverVehicle,
} from '@/api/driver.api';
import { ConflictError, getApiErrorMessage } from '@/api/errors';
import { PermissionGate } from '@/auth/permissions';
import {
  deviceProtocolColor,
  deviceStatusColor,
  driverStatusColor,
  fleetStatusColor,
  formatEngineHours,
  formatOdometerKm,
  vehicleStatusColor,
} from '@/components/assets/asset-meta';
import {
  devicesOnVehicle,
  driverOnVehicle,
  formatDeviceLabel,
} from '@/components/assets/driver-join';
import { ConfirmDialog } from '@/components/feedback/ConfirmDialog';
import { useToast } from '@/components/feedback/ToastProvider';
import {
  Alert,
  Badge,
  Button,
  Drawer,
  IconButton,
  Select,
  Spinner,
} from '@/components/tailwind-ui';
import type { AssetTab } from '@/pages/AssetManagementPage';
import type {
  BoundDevice,
  Device,
  DeviceRole,
  DeviceStatus,
  Driver,
  Fleet,
  Vehicle,
} from '@/types/asset.types';

interface AssetDetailDrawersProps {
  tab: AssetTab;
  selectedId: string | null;
  onClose: () => void;
  /** Registries for cross-resolution (fleet/vehicle names, unbound devices). */
  fleets: Fleet[];
  vehicles: Vehicle[];
  devices: Device[];
  drivers: Driver[];
}

/** Dispatcher: renders the drawer matching the active tab. */
export function AssetDetailDrawers({
  tab,
  selectedId,
  onClose,
  fleets,
  vehicles,
  devices,
  drivers,
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
          drivers={drivers}
        />
      )}
      {tab === 'devices' && (
        <DeviceDetailDrawer
          deviceId={selectedId}
          onClose={onClose}
          vehicles={vehicles}
          drivers={drivers}
        />
      )}
      {tab === 'drivers' && (
        <DriverDetailDrawer
          driverId={selectedId}
          onClose={onClose}
          vehicles={vehicles}
          devices={devices}
        />
      )}
    </>
  );
}

/** Shared slide-over shell — badge row rendered at the top of the body. */
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
  badge?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Drawer open={open} onClose={onClose} title={title} subtitle={subtitle} size="sm">
      {badge && <div className="mb-4">{badge}</div>}
      {children}
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
  children: ReactNode;
}) {
  const { t } = useTranslation();
  if (loading) {
    return (
      <div className="flex justify-center py-10">
        <Spinner size="lg" />
      </div>
    );
  }
  if (notFound) {
    return <p className="py-6 text-sm text-gray-500 dark:text-graydark-600">{t(notFoundKey)}</p>;
  }
  return <>{children}</>;
}

/** A labeled meta row. */
function MetaRow({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 py-1.5">
      <span className="flex w-5 shrink-0 justify-center text-gray-400 dark:text-graydark-600 [&_svg]:size-4">
        {icon}
      </span>
      <span className="w-28 shrink-0 text-sm text-gray-500 dark:text-graydark-600">{label}</span>
      <span className="min-w-0 flex-1 truncate text-sm text-gray-800 dark:text-graydark-800">
        {value}
      </span>
    </div>
  );
}

/** ISO → local string ('—' when null). */
function isoToLocal(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleString() : '—';
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="mt-5">
      <p className="text-xs font-semibold tracking-wide text-gray-400 uppercase dark:text-graydark-600">
        {label}
      </p>
      <div className="mt-1">{children}</div>
    </section>
  );
}

function Divider() {
  return <hr className="my-4 border-gray-100 dark:border-white/5" />;
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
          <Badge color={fleetStatusColor(fleet.status)} dot>
            {t(`assets.fleet.status.${fleet.status}`)}
          </Badge>
        ) : null
      }
    >
      <DrawerBody
        loading={isLoading}
        notFound={open && !isLoading && !fleet}
        notFoundKey="assets.fleet.notFound"
      >
        {fleet && (
          <div className="flex flex-col gap-3">
            <div>
              <MetaRow icon={<Truck />} label={t('assets.fleet.code')} value={fleet.code} />
              <MetaRow
                icon={<Truck />}
                label={t('assets.fleet.colVehicles')}
                value={t('assets.fleet.vehiclesCount', { count: vehicleCount })}
              />
              <MetaRow
                icon={<Truck />}
                label={t('assets.fleet.description')}
                value={fleet.description ?? '—'}
              />
            </div>
            <Divider />
            <Section label={t('assets.fleet.updatedAt')}>
              <MetaRow
                icon={<Calendar />}
                label={t('assets.fleet.createdAt')}
                value={isoToLocal(fleet.createdAt)}
              />
              <MetaRow
                icon={<Calendar />}
                label={t('assets.fleet.updatedAt')}
                value={isoToLocal(fleet.updatedAt)}
              />
            </Section>
          </div>
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
  drivers,
}: {
  vehicleId: string | null;
  onClose: () => void;
  fleets: Fleet[];
  devices: Device[];
  drivers: Driver[];
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
  const assignedDriver = useMemo(() => driverOnVehicle(drivers, vehicleId), [drivers, vehicleId]);
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
            <Badge color={vehicleStatusColor(vehicle.status)} dot>
              {t(`assets.vehicle.status.${vehicle.status}`)}
            </Badge>
          ) : null
        }
      >
        <DrawerBody
          loading={isLoading}
          notFound={open && !isLoading && !vehicle}
          notFoundKey="assets.vehicle.notFound"
        >
          {vehicle && (
            <div className="flex flex-col gap-3">
              <div>
                <MetaRow icon={<Truck />} label={t('assets.vehicle.fleet')} value={fleetName} />
                <MetaRow
                  icon={<Truck />}
                  label={t('assets.vehicle.plate')}
                  value={vehicle.plate ?? '—'}
                />
                <MetaRow
                  icon={<Truck />}
                  label={t('assets.vehicle.vin')}
                  value={vehicle.vin ?? '—'}
                />
                <MetaRow
                  icon={<Gauge />}
                  label={t('assets.vehicle.odometer')}
                  value={formatOdometerKm(vehicle.odometerKm)}
                />
                <MetaRow
                  icon={<Clock />}
                  label={t('assets.vehicle.engineHours')}
                  value={formatEngineHours(vehicle.engineHours)}
                />
                <MetaRow
                  icon={<UserRound />}
                  label={t('assets.vehicle.assignedDriver')}
                  value={
                    assignedDriver ? driverFullName(assignedDriver) : t('map.popup.unassigned')
                  }
                />
              </div>

              <Divider />

              {/* Bound devices (GET /vehicles/:id/devices) */}
              <Section label={t('assets.device.devices')}>
                {bound.isLoading ? (
                  <div className="flex justify-center py-3">
                    <Spinner size="sm" />
                  </div>
                ) : (bound.data ?? []).length === 0 ? (
                  <p className="py-2 text-sm text-gray-500 dark:text-graydark-600">
                    {t('assets.device.unbound')}
                  </p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {(bound.data ?? []).map((d) => (
                      <div
                        key={d.deviceId}
                        className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 dark:border-white/10"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-mono text-xs font-medium text-gray-800 dark:text-graydark-800">
                            {d.imei}
                          </p>
                          <p className="truncate text-xs text-gray-500 dark:text-graydark-600">
                            {[d.manufacturer, d.model].filter(Boolean).join(' ') || '—'}
                          </p>
                        </div>
                        <Badge color="gray">
                          {t(`assets.device.roles.${d.role}`, { defaultValue: d.role })}
                        </Badge>
                        {d.isPrimary && <Badge color="brand">{t('assets.device.primary')}</Badge>}
                        <Badge color={deviceStatusColor(d.deviceStatus as DeviceStatus)} dot>
                          {t(`assets.device.statusValues.${d.deviceStatus}`, {
                            defaultValue: d.deviceStatus,
                          })}
                        </Badge>
                        <PermissionGate requires="device.write">
                          <IconButton
                            size="sm"
                            variant="ghost"
                            aria-label={t('assets.device.unassign')}
                            onClick={() => setUnbindTarget(d)}
                          >
                            <Link2Off size={15} />
                          </IconButton>
                        </PermissionGate>
                      </div>
                    ))}
                  </div>
                )}

                {/* Assign flow — gated by device.write. */}
                <PermissionGate requires="device.write">
                  <div className="mt-3 flex flex-col gap-2">
                    {bindError && <Alert variant="danger">{bindError}</Alert>}
                    {unboundDevices.length === 0 ? (
                      <p className="text-xs text-gray-500 dark:text-graydark-600">
                        {t('assets.device.noUnbound')}
                      </p>
                    ) : (
                      <div className="flex flex-wrap items-start gap-2">
                        <Select
                          value={assignDeviceId}
                          onChange={(e) => setAssignDeviceId(e.target.value)}
                          wrapperClassName="min-w-40 flex-1"
                          aria-label={t('assets.device.imei')}
                          options={unboundDevices.map((d) => ({
                            value: d.id,
                            label: d.model ? `${d.imei} · ${d.model}` : d.imei,
                          }))}
                        />
                        <Select
                          value={assignRole}
                          onChange={(e) => setAssignRole(e.target.value as DeviceRole)}
                          wrapperClassName="w-32"
                          aria-label={t('assets.device.role')}
                          options={ROLE_OPTIONS.map((r) => ({
                            value: r,
                            label: t(`assets.device.roles.${r}`),
                          }))}
                        />
                        <Button
                          size="sm"
                          leftIcon={<Link2 size={14} />}
                          disabled={!assignDeviceId || bind.isPending}
                          loading={bind.isPending}
                          onClick={onAssign}
                        >
                          {t('assets.device.assignAction')}
                        </Button>
                      </div>
                    )}
                  </div>
                </PermissionGate>
              </Section>

              <Divider />
              <Section label={t('assets.vehicle.updatedAt')}>
                <MetaRow
                  icon={<Calendar />}
                  label={t('assets.vehicle.createdAt')}
                  value={isoToLocal(vehicle.createdAt)}
                />
                <MetaRow
                  icon={<Calendar />}
                  label={t('assets.vehicle.updatedAt')}
                  value={isoToLocal(vehicle.updatedAt)}
                />
              </Section>
            </div>
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
  drivers,
}: {
  deviceId: string | null;
  onClose: () => void;
  vehicles: Vehicle[];
  drivers: Driver[];
}) {
  const { t } = useTranslation();
  const { data: device, isLoading } = useDeviceDetail(deviceId);
  const open = Boolean(deviceId);
  const vehicle = useMemo(
    () => (device?.vehicleId ? vehicles.find((v) => v.id === device.vehicleId) : undefined),
    [vehicles, device?.vehicleId],
  );
  const assignedDriver = useMemo(
    () => driverOnVehicle(drivers, device?.vehicleId ?? null),
    [drivers, device?.vehicleId],
  );

  return (
    <DetailShell
      open={open}
      onClose={onClose}
      title={device?.imei ?? ''}
      subtitle={device ? [device.manufacturer, device.model].filter(Boolean).join(' ') : undefined}
      badge={
        device ? (
          <Badge color={deviceStatusColor(device.status)} dot>
            {t(`assets.device.statusValues.${device.status}`)}
          </Badge>
        ) : null
      }
    >
      <DrawerBody
        loading={isLoading}
        notFound={open && !isLoading && !device}
        notFoundKey="assets.device.notFound"
      >
        {device && (
          <div className="flex flex-col gap-3">
            <Section label={t('assets.device.registry')}>
              <MetaRow
                icon={<Smartphone />}
                label={t('assets.device.imei')}
                value={<span className="font-mono">{device.imei}</span>}
              />
              <MetaRow
                icon={<Cpu />}
                label={t('assets.device.serial')}
                value={device.serialNumber ?? '—'}
              />
              <MetaRow
                icon={<Cpu />}
                label={t('assets.device.manufacturer')}
                value={device.manufacturer ?? '—'}
              />
              <MetaRow
                icon={<Cpu />}
                label={t('assets.device.model')}
                value={device.model ?? '—'}
              />
              <MetaRow
                icon={<Cpu />}
                label={t('assets.device.protocol')}
                value={
                  <Badge color={deviceProtocolColor(device.protocol)} dot>
                    {t(`assets.device.protocols.${device.protocol}`)}
                  </Badge>
                }
              />
              <MetaRow
                icon={<Truck />}
                label={t('assets.device.colVehicle')}
                value={device.vehicleId ? (vehicle?.name ?? device.vehicleId) : '—'}
              />
              <MetaRow
                icon={<UserRound />}
                label={t('assets.device.assignedDriver')}
                value={assignedDriver ? driverFullName(assignedDriver) : t('map.popup.unassigned')}
              />
            </Section>

            <Divider />
            <Section label={t('assets.device.connection')}>
              <MetaRow
                icon={<CircleSlash />}
                label={t('assets.device.lastSeen')}
                value={isoToLocal(device.lastSeenAt)}
              />
              <MetaRow
                icon={<Link2 />}
                label={t('assets.device.connectedAt')}
                value={isoToLocal(device.connectedAt)}
              />
              <MetaRow
                icon={<Link2Off />}
                label={t('assets.device.disconnectedAt')}
                value={isoToLocal(device.disconnectedAt)}
              />
            </Section>

            <Divider />
            <Section label={t('assets.device.updatedAt')}>
              <MetaRow
                icon={<Calendar />}
                label={t('assets.device.createdAt')}
                value={isoToLocal(device.createdAt)}
              />
              <MetaRow
                icon={<Calendar />}
                label={t('assets.device.updatedAt')}
                value={isoToLocal(device.updatedAt)}
              />
            </Section>
          </div>
        )}
      </DrawerBody>
    </DetailShell>
  );
}

// ── Driver drawer (incl. vehicle assignment) ─────────────────────────────────

function DriverDetailDrawer({
  driverId,
  onClose,
  vehicles,
  devices,
}: {
  driverId: string | null;
  onClose: () => void;
  vehicles: Vehicle[];
  devices: Device[];
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const { data: driver, isLoading } = useDriverDetail(driverId);
  const assign = useAssignDriverVehicle();
  const unassign = useUnassignDriverVehicle();
  const open = Boolean(driverId);
  const [assignVehicleId, setAssignVehicleId] = useState('');

  const vehicle = useMemo(
    () =>
      driver?.assignedVehicleId
        ? vehicles.find((v) => v.id === driver.assignedVehicleId)
        : undefined,
    [vehicles, driver?.assignedVehicleId],
  );
  const boundDevices = useMemo(
    () => devicesOnVehicle(devices, driver?.assignedVehicleId ?? null),
    [devices, driver?.assignedVehicleId],
  );
  const freeVehicles = useMemo(() => vehicles.filter((v) => v.status === 'ACTIVE'), [vehicles]);

  const onAssign = async () => {
    if (!driverId || !assignVehicleId) return;
    try {
      await assign.mutateAsync({ driverId, vehicleId: assignVehicleId });
      toast.success(t('assets.crud.updateSuccess', { name: t('assets.tabs.drivers') }));
      setAssignVehicleId('');
    } catch (err) {
      toast.error(err);
    }
  };

  const onUnassign = async () => {
    if (!driverId) return;
    try {
      await unassign.mutateAsync(driverId);
      toast.success(t('assets.crud.updateSuccess', { name: t('assets.tabs.drivers') }));
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <DetailShell
      open={open}
      onClose={onClose}
      title={driver ? driverFullName(driver) : ''}
      subtitle={driver?.employeeId ?? undefined}
      badge={
        driver ? (
          <Badge color={driverStatusColor(driver.status)} dot>
            {t(`assets.driver.status.${driver.status}`)}
          </Badge>
        ) : null
      }
    >
      <DrawerBody
        loading={isLoading}
        notFound={open && !isLoading && !driver}
        notFoundKey="assets.driver.notFound"
      >
        {driver && (
          <div className="flex flex-col gap-3">
            <div>
              <MetaRow
                icon={<IdCard />}
                label={t('assets.driver.licenseNumber')}
                value={
                  <span className="font-mono">
                    {[driver.licenseClass, driver.licenseNumber].filter(Boolean).join(' · ')}
                  </span>
                }
              />
              <MetaRow
                icon={<Calendar />}
                label={t('assets.driver.licenseExpires')}
                value={
                  driver.licenseExpires ? new Date(driver.licenseExpires).toLocaleDateString() : '—'
                }
              />
              <MetaRow
                icon={<IdCard />}
                label={t('assets.driver.licenseCountry')}
                value={driver.licenseCountry ?? '—'}
              />
              <MetaRow
                icon={<Phone />}
                label={t('assets.driver.phone')}
                value={driver.phone ?? '—'}
              />
              <MetaRow
                icon={<UserRound />}
                label={t('assets.driver.email')}
                value={driver.email ?? '—'}
              />
            </div>

            <Divider />
            <Section label={t('assets.driver.assignedVehicle')}>
              <MetaRow
                icon={<Truck />}
                label={t('assets.driver.colVehicle')}
                value={vehicle?.name ?? t('map.popup.unassigned')}
              />
              <MetaRow
                icon={<Smartphone />}
                label={t('assets.driver.assignedDevice')}
                value={
                  boundDevices.length === 0 ? (
                    driver.assignedVehicleId ? (
                      t('assets.driver.noDevice')
                    ) : (
                      t('map.popup.unassigned')
                    )
                  ) : (
                    <span className="flex flex-col gap-0.5 font-mono text-xs">
                      {boundDevices.map((d) => (
                        <span key={d.id}>{formatDeviceLabel(d)}</span>
                      ))}
                    </span>
                  )
                }
              />
              <PermissionGate requires="fleet.driver.update">
                <div className="mt-3 flex flex-wrap items-start gap-2">
                  <Select
                    value={assignVehicleId}
                    onChange={(e) => setAssignVehicleId(e.target.value)}
                    wrapperClassName="min-w-40 flex-1"
                    aria-label={t('assets.driver.assignedVehicle')}
                    placeholder={t('assets.driver.pickVehicle')}
                    options={freeVehicles.map((v) => ({
                      value: v.id,
                      label: v.plate ? `${v.name} · ${v.plate}` : v.name,
                    }))}
                  />
                  <Button
                    size="sm"
                    leftIcon={<Link2 size={14} />}
                    disabled={!assignVehicleId || assign.isPending}
                    loading={assign.isPending}
                    onClick={onAssign}
                  >
                    {t('common.assign')}
                  </Button>
                  {driver.assignedVehicleId && (
                    <Button
                      size="sm"
                      variant="outline"
                      leftIcon={<Link2Off size={14} />}
                      disabled={unassign.isPending}
                      loading={unassign.isPending}
                      onClick={onUnassign}
                    >
                      {t('assets.driver.unassign')}
                    </Button>
                  )}
                </div>
              </PermissionGate>
            </Section>
          </div>
        )}
      </DrawerBody>
    </DetailShell>
  );
}
