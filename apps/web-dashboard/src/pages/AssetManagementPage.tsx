/**
 * AssetManagementPage — the consolidated fleet-asset registry (`/assets`).
 *
 * Four tabs — Fleets · Vehicles · Devices · Drivers. Fleets/vehicles/devices
 * talk to fleet-management (Sprint E); drivers talk to fleet-service
 * (`/api/v1/fleet/drivers`). Soft-delete: fleets/vehicles = ARCHIVE, devices =
 * DECOMMISSION, drivers = DEACTIVATE. The active tab + selection sync to the
 * URL (`?tab=vehicles`). Legacy `/fleets`, `/vehicles`, `/devices`, `/drivers`
 * routes redirect here.
 *
 * Write actions (+ Add, edit, archive/decommission/deactivate) are gated per
 * tab via <PermissionGate> — the backend enforces the same strings.
 */
import { Cpu, Download, FolderTree, Plus, Truck, Upload, UserRound } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

import {
  useArchiveFleet,
  useArchiveVehicle,
  useDecommissionDevice,
  useDevices,
  useFleets,
  useVehicles,
} from '@/api/asset.api';
import { useDeactivateDriver, useDrivers } from '@/api/driver.api';
import { PERMISSIONS, PermissionGate } from '@/auth/permissions';
import { AssetDetailDrawers } from '@/components/assets/AssetDetailDrawers';
import { AssetFormDrawer, type AssetRecord } from '@/components/assets/AssetFormDrawer';
import { AssetImportDialog } from '@/components/assets/AssetImportDialog';
import { DevicesTab } from '@/components/assets/DevicesTab';
import { DriversTab } from '@/components/assets/DriversTab';
import { FleetsTab } from '@/components/assets/FleetsTab';
import { VehiclesTab } from '@/components/assets/VehiclesTab';
import { ErrorState } from '@/components/common/ErrorState';
import { ConfirmDialog } from '@/components/feedback/ConfirmDialog';
import { useToast } from '@/components/feedback/ToastProvider';
import { Button, PageHeader, Tabs } from '@/components/tailwind-ui';
import { downloadAssetExport } from '@/lib/asset-export';
import type { AssetImportKind } from '@/lib/asset-import';
import type {
  DeviceProtocol,
  DeviceStatus,
  DriverStatus,
  FleetStatus,
  VehicleStatus,
} from '@/types/asset.types';

/** The four registry tabs. */
export type AssetTab = 'fleets' | 'vehicles' | 'devices' | 'drivers';

const TABS: AssetTab[] = ['fleets', 'vehicles', 'devices', 'drivers'];

/** Per-tab write permission (gates + Add). */
const WRITE_PERMISSION: Record<AssetTab, string> = {
  fleets: PERMISSIONS.fleetWrite,
  vehicles: PERMISSIONS.vehicleWrite,
  devices: PERMISSIONS.deviceWrite,
  drivers: PERMISSIONS.driverCreate,
};

function tabIcon(tb: AssetTab) {
  if (tb === 'fleets') return <FolderTree />;
  if (tb === 'vehicles') return <Truck />;
  if (tb === 'drivers') return <UserRound />;
  return <Cpu />;
}

function confirmCopy(tab: AssetTab): {
  titleKey: string;
  bodyKey: string;
  labelKey: string;
  successKey: string;
} {
  if (tab === 'devices') {
    return {
      titleKey: 'assets.crud.decommissionConfirmTitle',
      bodyKey: 'assets.crud.decommissionConfirmBody',
      labelKey: 'assets.actions.decommission',
      successKey: 'assets.crud.decommissionSuccess',
    };
  }
  if (tab === 'drivers') {
    return {
      titleKey: 'assets.crud.deactivateConfirmTitle',
      bodyKey: 'assets.crud.deactivateConfirmBody',
      labelKey: 'assets.actions.deactivate',
      successKey: 'assets.crud.deactivateSuccess',
    };
  }
  return {
    titleKey: 'assets.crud.archiveConfirmTitle',
    bodyKey: 'assets.crud.archiveConfirmBody',
    labelKey: 'assets.actions.archive',
    successKey: 'assets.crud.archiveSuccess',
  };
}

/** Clamp the tab from URL params to a valid tab (default: vehicles). */
function readTab(value: string | null): AssetTab {
  return (TABS as readonly string[]).includes(value ?? '') ? (value as AssetTab) : 'vehicles';
}

export function AssetManagementPage() {
  const { t } = useTranslation();
  const toast = useToast();
  const [params, setParams] = useSearchParams();

  const tab = readTab(params.get('tab'));
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Per-tab filter state (kept here so switching tabs preserves filters).
  const [fleetStatus, setFleetStatus] = useState<FleetStatus | 'all'>('all');
  const [fleetQuery, setFleetQuery] = useState('');
  const [vehFleet, setVehFleet] = useState<string | 'all'>('all');
  const [vehStatus, setVehStatus] = useState<VehicleStatus | 'all'>('all');
  const [vehQuery, setVehQuery] = useState('');
  const [devStatus, setDevStatus] = useState<DeviceStatus | 'all'>('all');
  const [devProtocol, setDevProtocol] = useState<DeviceProtocol | 'all'>('all');
  const [devQuery, setDevQuery] = useState('');
  const [drvStatus, setDrvStatus] = useState<DriverStatus | 'all'>('all');
  const [drvQuery, setDrvQuery] = useState('');

  const fleetsQuery = useFleets();
  const vehiclesQuery = useVehicles();
  const devicesQuery = useDevices();
  const driversQuery = useDrivers();

  const fleets = fleetsQuery.data ?? [];
  const vehicles = vehiclesQuery.data ?? [];
  const devices = devicesQuery.data ?? [];
  const drivers = driversQuery.data ?? [];

  const archiveFleet = useArchiveFleet();
  const archiveVehicle = useArchiveVehicle();
  const decommissionDevice = useDecommissionDevice();
  const deactivateDriver = useDeactivateDriver();
  const deleteMutation =
    tab === 'fleets'
      ? archiveFleet
      : tab === 'vehicles'
        ? archiveVehicle
        : tab === 'drivers'
          ? deactivateDriver
          : decommissionDevice;

  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<'create' | 'edit'>('create');
  const [editRecord, setEditRecord] = useState<AssetRecord | undefined>(undefined);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const counts = useMemo(
    () => ({
      fleets: fleets.length,
      vehicles: vehicles.length,
      devices: devices.length,
      drivers: drivers.length,
    }),
    [fleets.length, vehicles.length, devices.length, drivers.length],
  );

  const setTab = (next: AssetTab) => {
    const p = new URLSearchParams(params);
    p.set('tab', next);
    setParams(p, { replace: true });
    setSelectedId(null);
    setImportOpen(false);
  };

  const openCreate = () => {
    setFormMode('create');
    setEditRecord(undefined);
    setFormOpen(true);
  };
  const openEdit = (record: AssetRecord) => {
    setFormMode('edit');
    setEditRecord(record);
    setFormOpen(true);
  };

  const copy = confirmCopy(tab);
  const onConfirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteMutation.mutateAsync(deleteTarget.id);
      toast.success(t(copy.successKey, { name: deleteTarget.name }));
      setDeleteTarget(null);
    } catch (err) {
      toast.error(err);
    }
  };

  const listQuery =
    tab === 'fleets'
      ? fleetsQuery
      : tab === 'vehicles'
        ? vehiclesQuery
        : tab === 'drivers'
          ? driversQuery
          : devicesQuery;

  const showImport = tab === 'vehicles' || tab === 'devices' || tab === 'drivers';
  const importKind: AssetImportKind =
    tab === 'devices' ? 'devices' : tab === 'drivers' ? 'drivers' : 'vehicles';

  const onExport = () => {
    downloadAssetExport(
      tab,
      { fleets, vehicles, devices, drivers },
      {
        fleetStatus,
        fleetQuery,
        vehStatus,
        vehFleet,
        vehQuery,
        devStatus,
        devProtocol,
        devQuery,
        drvStatus,
        drvQuery,
      },
    );
  };

  return (
    <div className="flex h-full flex-col gap-4">
      <PageHeader
        title={t('assets.title')}
        description={t('assets.subtitle')}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              leftIcon={<Download size={15} />}
              onClick={onExport}
              type="button"
            >
              {t('assets.export.action')}
            </Button>
            {showImport && (
              <PermissionGate requires={WRITE_PERMISSION[tab]}>
                <Button
                  size="sm"
                  variant="outline"
                  leftIcon={<Upload size={15} />}
                  onClick={() => setImportOpen(true)}
                >
                  {t('assets.import.action')}
                </Button>
              </PermissionGate>
            )}
            <PermissionGate requires={WRITE_PERMISSION[tab]}>
              <Button size="sm" leftIcon={<Plus size={15} />} onClick={openCreate}>
                {t('common.add')} {t(`assets.tabs.${tab}`)}
              </Button>
            </PermissionGate>
          </div>
        }
      />

      <Tabs
        aria-label={t('assets.title')}
        value={tab}
        onChange={setTab}
        tabs={TABS.map((tb) => ({
          value: tb,
          label: t(`assets.tabs.${tb}`),
          icon: tabIcon(tb),
          count: counts[tb],
        }))}
      />

      <div className="min-h-0 flex-1">
        {listQuery.isError ? (
          <ErrorState error={listQuery.error} onRetry={() => listQuery.refetch()} />
        ) : (
          <>
            {tab === 'fleets' && (
              <FleetsTab
                fleets={fleets}
                vehicles={vehicles}
                loading={fleetsQuery.isLoading}
                selectedId={selectedId}
                onSelect={setSelectedId}
                filterStatus={fleetStatus}
                query={fleetQuery}
                onFilterStatus={setFleetStatus}
                onQuery={setFleetQuery}
                onEdit={openEdit}
                onDelete={(id, name) => setDeleteTarget({ id, name })}
              />
            )}
            {tab === 'vehicles' && (
              <VehiclesTab
                vehicles={vehicles}
                fleets={fleets}
                loading={vehiclesQuery.isLoading}
                selectedId={selectedId}
                onSelect={setSelectedId}
                filterStatus={vehStatus}
                filterFleet={vehFleet}
                query={vehQuery}
                onFilterStatus={setVehStatus}
                onFilterFleet={setVehFleet}
                onQuery={setVehQuery}
                onEdit={openEdit}
                onDelete={(id, name) => setDeleteTarget({ id, name })}
              />
            )}
            {tab === 'devices' && (
              <DevicesTab
                devices={devices}
                vehicles={vehicles}
                drivers={drivers}
                loading={devicesQuery.isLoading}
                selectedId={selectedId}
                onSelect={setSelectedId}
                filterStatus={devStatus}
                filterProtocol={devProtocol}
                query={devQuery}
                onFilterStatus={setDevStatus}
                onFilterProtocol={setDevProtocol}
                onQuery={setDevQuery}
                onEdit={openEdit}
                onDelete={(id, name) => setDeleteTarget({ id, name })}
              />
            )}
            {tab === 'drivers' && (
              <DriversTab
                drivers={drivers}
                vehicles={vehicles}
                devices={devices}
                loading={driversQuery.isLoading}
                selectedId={selectedId}
                onSelect={setSelectedId}
                filterStatus={drvStatus}
                query={drvQuery}
                onFilterStatus={setDrvStatus}
                onQuery={setDrvQuery}
                onEdit={openEdit}
                onDelete={(id, name) => setDeleteTarget({ id, name })}
              />
            )}
          </>
        )}
      </div>

      <AssetDetailDrawers
        tab={tab}
        selectedId={selectedId}
        onClose={() => setSelectedId(null)}
        fleets={fleets}
        vehicles={vehicles}
        devices={devices}
        drivers={drivers}
      />

      <AssetFormDrawer
        open={formOpen}
        mode={formMode}
        entity={tab}
        record={editRecord}
        fleets={fleets}
        vehicles={vehicles}
        onClose={() => setFormOpen(false)}
      />

      {showImport && (
        <AssetImportDialog
          open={importOpen}
          kind={importKind}
          vehicles={vehicles}
          onClose={() => setImportOpen(false)}
        />
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        title={t(copy.titleKey, { name: deleteTarget?.name ?? '' })}
        message={t(copy.bodyKey)}
        confirmLabelKey={copy.labelKey}
        loading={deleteMutation.isPending}
        onConfirm={onConfirmDelete}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}
