/**
 * Asset detail drawers — right slide-overs for the four asset classes.
 *
 * One file holds all four because they share the MUI Drawer slide-over pattern
 * (UI_UX §0.6 selection → detail) and a common meta-row helper. Each renders
 * the full entity attributes + the relevant status action. The active drawer
 * is selected by the current tab + selected id.
 */
import { BatteryFull, Gauge, MapPin, Truck, Wrench } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import {
  useDeviceDetail,
  useDriverDetail,
  useVehicleDetail,
  useVehicleStatusAction,
} from '@/api/asset.api';
import {
  deviceStatusColor,
  driverStatusColor,
  signalColor,
  vehicleStatusColor,
} from '@/components/assets/asset-meta';
import { StatusBadge } from '@/components/ui';
import type { AssetTab } from '@/pages/AssetManagementPage';
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  Drawer,
  IconButton,
  Stack,
  Typography,
} from '@mui/material';

const DRAWER_WIDTH = 420;

interface AssetDetailDrawersProps {
  tab: AssetTab;
  selectedId: string | null;
  onClose: () => void;
}

/** Dispatcher: renders the drawer matching the active tab. */
export function AssetDetailDrawers({ tab, selectedId, onClose }: AssetDetailDrawersProps) {
  return (
    <>
      {tab === 'vehicles' && (
        <VehicleDetailDrawer vehicleId={tab === 'vehicles' ? selectedId : null} onClose={onClose} />
      )}
      {tab === 'drivers' && (
        <DriverDetailDrawer driverId={tab === 'drivers' ? selectedId : null} onClose={onClose} />
      )}
      {tab === 'devices' && (
        <DeviceDetailDrawer deviceId={tab === 'devices' ? selectedId : null} onClose={onClose} />
      )}
      {/* Groups have no separate detail drawer in this sprint; selection is
          surfaced via the card highlight only. */}
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
  badge?: ReactNode;
  children: ReactNode;
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
}: { loading: boolean; notFound: boolean; notFoundKey: string; children: ReactNode }) {
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
function MetaRow({ icon, label, value }: { icon: ReactNode; label: string; value: ReactNode }) {
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

function Section({ label, children }: { label: string; children: ReactNode }) {
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

// ── Vehicle drawer ───────────────────────────────────────────────────────────

function VehicleDetailDrawer({
  vehicleId,
  onClose,
}: { vehicleId: string | null; onClose: () => void }) {
  const { t } = useTranslation();
  const { data: vehicle, isLoading } = useVehicleDetail(vehicleId);
  const action = useVehicleStatusAction();
  const open = Boolean(vehicleId);

  return (
    <DetailShell
      open={open}
      onClose={onClose}
      title={vehicle ? `${vehicle.make} ${vehicle.model}` : ''}
      subtitle={vehicle ? vehicle.licensePlate : ''}
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
                label={t('assets.vehicle.vin')}
                value={vehicle.vin}
              />
              <MetaRow
                icon={<Truck size={16} />}
                label={t('assets.vehicle.colType')}
                value={t(`assets.vehicle.type.${vehicle.type}`)}
              />
              <MetaRow
                icon={<Gauge size={16} />}
                label={t('assets.vehicle.colOdometer')}
                value={`${vehicle.odometerKm.toLocaleString()} km`}
              />
              <MetaRow
                icon={<MapPin size={16} />}
                label={t('assets.vehicle.fleet')}
                value={vehicle.fleetName}
              />
              <MetaRow
                icon={<Truck size={16} />}
                label={t('assets.vehicle.fuelType')}
                value={t(`assets.vehicle.fuel.${vehicle.fuelType}`)}
              />
              <MetaRow
                icon={<Truck size={16} />}
                label={t('assets.vehicle.device')}
                value={vehicle.deviceId ?? '—'}
              />
            </Box>

            <Divider />
            <Section label={t('assets.vehicle.actions')}>
              <Stack direction="row" gap={1} sx={{ flexWrap: 'wrap' }}>
                {vehicle.status !== 'maintenance' && (
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<Wrench size={14} />}
                    disabled={action.isPending}
                    onClick={() => action.mutate({ id: vehicle.id, status: 'maintenance' })}
                  >
                    {t('assets.vehicle.toMaintenance')}
                  </Button>
                )}
                {vehicle.status === 'maintenance' && (
                  <Button
                    size="small"
                    variant="contained"
                    disabled={action.isPending}
                    onClick={() => action.mutate({ id: vehicle.id, status: 'active' })}
                  >
                    {t('assets.vehicle.fromMaintenance')}
                  </Button>
                )}
              </Stack>
            </Section>
          </Stack>
        )}
      </DrawerBody>
    </DetailShell>
  );
}

// ── Driver drawer ────────────────────────────────────────────────────────────

function DriverDetailDrawer({
  driverId,
  onClose,
}: { driverId: string | null; onClose: () => void }) {
  const { t } = useTranslation();
  const { data: driver, isLoading } = useDriverDetail(driverId);
  const open = Boolean(driverId);

  return (
    <DetailShell
      open={open}
      onClose={onClose}
      title={driver ? `${driver.firstName} ${driver.lastName}` : ''}
      subtitle={driver?.email}
      badge={
        driver ? (
          <StatusBadge
            label={t(`assets.driver.status.${driver.status}`)}
            color={driverStatusColor(driver.status)}
            variant="solid"
          />
        ) : null
      }
    >
      <DrawerBody
        loading={isLoading}
        notFound={open && !isLoading && !driver}
        notFoundKey="assets.driver.notFound"
      >
        {driver && (
          <Stack gap={2} sx={{ p: 2 }}>
            <Box>
              <MetaRow
                icon={<Truck size={16} />}
                label={t('assets.driver.license')}
                value={`${driver.licenseClass} · ${driver.licenseNumber}`}
              />
              <MetaRow
                icon={<Truck size={16} />}
                label={t('assets.driver.licenseExpiry')}
                value={new Date(driver.licenseExpiry).toLocaleDateString()}
              />
              <MetaRow
                icon={<Truck size={16} />}
                label={t('assets.driver.employeeId')}
                value={driver.employeeId ?? '—'}
              />
              <MetaRow
                icon={<Truck size={16} />}
                label={t('assets.driver.phone')}
                value={driver.phone}
              />
              <MetaRow
                icon={<Truck size={16} />}
                label={t('assets.driver.assigned')}
                value={driver.assignedVehicleLabel ?? '—'}
              />
            </Box>
            <Divider />
            <Section label={t('assets.driver.behavior')}>
              <Stack direction="row" gap={3}>
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    {t('assets.driver.colScore')}
                  </Typography>
                  <Typography variant="h5" sx={{ color: scoreColor(driver.behaviorScore) }}>
                    {driver.behaviorScore}
                  </Typography>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    {t('assets.driver.totalTrips')}
                  </Typography>
                  <Typography variant="h6">{driver.totalTrips.toLocaleString()}</Typography>
                </Box>
                <Box>
                  <Typography variant="caption" color="text.secondary">
                    {t('assets.driver.totalDistance')}
                  </Typography>
                  <Typography variant="h6">
                    {Math.round(driver.totalDistanceKm).toLocaleString()} km
                  </Typography>
                </Box>
              </Stack>
            </Section>
            {driver.certifications.length > 0 && (
              <Section label={t('assets.driver.certifications')}>
                <Stack direction="row" gap={0.5} sx={{ flexWrap: 'wrap' }}>
                  {driver.certifications.map((c, i) => (
                    <Chip key={`cert-${i}-${c}`} size="small" label={c} variant="outlined" />
                  ))}
                </Stack>
              </Section>
            )}
          </Stack>
        )}
      </DrawerBody>
    </DetailShell>
  );
}

// ── Device drawer ────────────────────────────────────────────────────────────

function DeviceDetailDrawer({
  deviceId,
  onClose,
}: { deviceId: string | null; onClose: () => void }) {
  const { t } = useTranslation();
  const { data: device, isLoading } = useDeviceDetail(deviceId);
  const open = Boolean(deviceId);

  return (
    <DetailShell
      open={open}
      onClose={onClose}
      title={device ? device.serialNumber : ''}
      subtitle={device ? `${device.manufacturer} ${device.model}` : ''}
      badge={
        device ? (
          <StatusBadge
            label={t(`assets.device.status.${device.status}`)}
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
            <Box>
              <MetaRow
                icon={<Truck size={16} />}
                label={t('assets.device.colType')}
                value={t(`assets.device.type.${device.deviceType}`)}
              />
              <MetaRow icon={<Truck size={16} />} label="IMEI" value={device.imei ?? '—'} />
              <MetaRow
                icon={<Truck size={16} />}
                label={t('assets.device.firmware')}
                value={device.firmwareVersion}
              />
              <MetaRow
                icon={<Truck size={16} />}
                label={t('assets.device.colVehicle')}
                value={device.boundVehicleLabel ?? '—'}
              />
              <MetaRow
                icon={<Truck size={16} />}
                label={t('assets.device.reportingInterval')}
                value={`${device.reportingIntervalSec}s`}
              />
            </Box>
            <Divider />
            <Section label={t('assets.device.health')}>
              <Box>
                {device.batteryLevel !== undefined && (
                  <MetaRow
                    icon={<BatteryFull size={16} />}
                    label={t('assets.device.battery')}
                    value={`${device.batteryLevel}%`}
                  />
                )}
                {device.signalStrengthDbm !== undefined && (
                  <MetaRow
                    icon={<Truck size={16} />}
                    label={t('assets.device.signal')}
                    value={
                      <span style={{ color: signalColor(device.signalStrengthDbm) }}>
                        {device.signalStrengthDbm} dBm
                      </span>
                    }
                  />
                )}
                {device.lastHeartbeatAt && (
                  <MetaRow
                    icon={<Truck size={16} />}
                    label={t('assets.device.lastHeartbeat')}
                    value={new Date(device.lastHeartbeatAt).toLocaleString()}
                  />
                )}
                {device.targetFirmwareVersion && (
                  <MetaRow
                    icon={<Truck size={16} />}
                    label={t('assets.device.targetFirmware')}
                    value={device.targetFirmwareVersion}
                  />
                )}
              </Box>
            </Section>
          </Stack>
        )}
      </DrawerBody>
    </DetailShell>
  );
}

/** Reuse the score-color helper without re-importing the tab. */
function scoreColor(score: number): string {
  if (score >= 80) return '#16A34A';
  if (score >= 65) return '#F59E0B';
  return '#DC2626';
}
