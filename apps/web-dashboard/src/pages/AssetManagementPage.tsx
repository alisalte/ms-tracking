/**
 * AssetManagementPage — the consolidated fleet-asset registry (`/assets`).
 *
 * Three tabs — Fleets · Vehicles · Devices — over the REAL fleet-management
 * contracts (Sprint E). Full CRUD: list/view/create/edit + soft-delete
 * (fleets/vehicles = ARCHIVE, devices = DECOMMISSION). The active tab +
 * selection sync to the URL (`?tab=vehicles`). Legacy `/fleets`, `/vehicles`
 * and `/devices` routes redirect here.
 *
 * Write actions (+ Add, edit, archive/decommission) are gated per tab via
 * <PermissionGate> (`fleet.write` / `vehicle.write` / `device.write`) — the
 * backend enforces the same strings (Sprint E §23/§24).
 */
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
import { PERMISSIONS, PermissionGate } from '@/auth/permissions';
import { AssetDetailDrawers } from '@/components/assets/AssetDetailDrawers';
import { AssetFormDrawer, type AssetRecord } from '@/components/assets/AssetFormDrawer';
import { DevicesTab } from '@/components/assets/DevicesTab';
import { FleetsTab } from '@/components/assets/FleetsTab';
import { VehiclesTab } from '@/components/assets/VehiclesTab';
import { ErrorState } from '@/components/common/ErrorState';
import { ConfirmDialog } from '@/components/feedback/ConfirmDialog';
import { useToast } from '@/components/feedback/ToastProvider';
import { Button, Tabs } from '@/components/tailwind-ui';
import type { DeviceProtocol, DeviceStatus, FleetStatus, VehicleStatus } from '@/types/asset.types';
import { FolderTree, Plus, Truck } from 'lucide-react';
import { Cpu } from 'lucide-react';

/** The three real asset-class tabs. */
export type AssetTab = 'fleets' | 'vehicles' | 'devices';

const TABS: AssetTab[] = ['fleets', 'vehicles', 'devices'];

/** Per-tab write permission (gates + Add / edit / archive). */
const WRITE_PERMISSION: Record<AssetTab, string> = {
  fleets: PERMISSIONS.fleetWrite,
  vehicles: PERMISSIONS.vehicleWrite,
  devices: PERMISSIONS.deviceWrite,
};

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

  const fleetsQuery = useFleets();
  const vehiclesQuery = useVehicles();
  const devicesQuery = useDevices();

  const fleets = fleetsQuery.data ?? [];
  const vehicles = vehiclesQuery.data ?? [];
  const devices = devicesQuery.data ?? [];

  // Soft-delete hooks (fleets/vehicles = archive, devices = decommission).
  const archiveFleet = useArchiveFleet();
  const archiveVehicle = useArchiveVehicle();
  const decommissionDevice = useDecommissionDevice();
  const deleteMutation =
    tab === 'fleets' ? archiveFleet : tab === 'vehicles' ? archiveVehicle : decommissionDevice;

  // ── CRUD trigger state ──
  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<'create' | 'edit'>('create');
  const [editRecord, setEditRecord] = useState<AssetRecord | undefined>(undefined);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);

  // Tab counts for the tab badges.
  const counts = useMemo(
    () => ({ fleets: fleets.length, vehicles: vehicles.length, devices: devices.length }),
    [fleets.length, vehicles.length, devices.length],
  );

  const setTab = (next: AssetTab) => {
    const p = new URLSearchParams(params);
    p.set('tab', next);
    setParams(p, { replace: true });
    setSelectedId(null);
  };

  // ── Create/Edit handlers ──
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

  // ── Delete handler (confirm → hook). Backend DELETE is soft: fleets and
  // vehicles are ARCHIVED, devices are DECOMMISSIONED.
  const isDeviceTab = tab === 'devices';
  const onConfirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteMutation.mutateAsync(deleteTarget.id);
      toast.success(
        t(isDeviceTab ? 'assets.crud.decommissionSuccess' : 'assets.crud.archiveSuccess', {
          name: deleteTarget.name,
        }),
      );
      setDeleteTarget(null);
    } catch (err) {
      toast.error(err);
    }
  };

  const listQuery =
    tab === 'fleets' ? fleetsQuery : tab === 'vehicles' ? vehiclesQuery : devicesQuery;

  return (
    <div className="flex h-full flex-col gap-4">
      {/* Header — + Add is permission-gated per tab. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-gray-900 dark:text-white">
            {t('assets.title')}
          </h1>
          <p className="text-sm text-gray-500 dark:text-graydark-600">{t('assets.subtitle')}</p>
        </div>
        <PermissionGate requires={WRITE_PERMISSION[tab]}>
          <Button size="sm" leftIcon={<Plus size={15} />} onClick={openCreate}>
            {t('common.add')} {t(`assets.tabs.${tab}`)}
          </Button>
        </PermissionGate>
      </div>

      {/* Tabs */}
      <Tabs
        aria-label={t('assets.title')}
        value={tab}
        onChange={setTab}
        tabs={TABS.map((tb) => ({
          value: tb,
          label: t(`assets.tabs.${tb}`),
          icon: tb === 'fleets' ? <FolderTree /> : tb === 'vehicles' ? <Truck /> : <Cpu />,
          count: counts[tb],
        }))}
      />

      {/* Active tab */}
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
          </>
        )}
      </div>

      {/* Detail drawer for the active tab */}
      <AssetDetailDrawers
        tab={tab}
        selectedId={selectedId}
        onClose={() => setSelectedId(null)}
        fleets={fleets}
        vehicles={vehicles}
        devices={devices}
      />

      {/* Create / Edit form drawer */}
      <AssetFormDrawer
        open={formOpen}
        mode={formMode}
        entity={tab}
        record={editRecord}
        fleets={fleets}
        onClose={() => setFormOpen(false)}
      />

      {/* Archive / Decommission confirmation (backend is soft-delete). */}
      <ConfirmDialog
        open={deleteTarget !== null}
        title={t(
          isDeviceTab ? 'assets.crud.decommissionConfirmTitle' : 'assets.crud.archiveConfirmTitle',
          { name: deleteTarget?.name ?? '' },
        )}
        message={t(
          isDeviceTab ? 'assets.crud.decommissionConfirmBody' : 'assets.crud.archiveConfirmBody',
        )}
        confirmLabelKey={isDeviceTab ? 'assets.actions.decommission' : 'assets.actions.archive'}
        loading={deleteMutation.isPending}
        onConfirm={onConfirmDelete}
        onClose={() => setDeleteTarget(null)}
      />
    </div>
  );
}
