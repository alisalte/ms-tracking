/**
 * AssetManagementPage — the consolidated fleet-asset registry (`/assets`).
 *
 * Four tabs — Vehicles · Drivers · Devices · Groups — over the operational
 * asset entity models. Full CRUD: list/view/create/edit/delete + assignment
 * actions. The active tab + selection sync to the URL (`?tab=vehicles`). The
 * existing `/vehicles` and `/drivers` nav items redirect here.
 *
 * v3 (CRUD): an `+ Add` action opens the shared `AssetFormDrawer` in create
 * mode; per-row action menus in each tab open it in edit mode and trigger
 * delete via a confirm dialog. All mutations use the real hooks in
 * `asset.api.ts` (with mock fallback) — see docs/frontend-crud.md.
 */
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

import {
  useDeleteDevice,
  useDeleteDriver,
  useDeleteGroup,
  useDeleteVehicle,
  useDevices,
  useDrivers,
  useGroups,
  useVehicles,
} from '@/api/asset.api';
import { AssetDetailDrawers } from '@/components/assets/AssetDetailDrawers';
import {
  AssetFormDrawer,
  type AssetRecord,
} from '@/components/assets/AssetFormDrawer';
import { DevicesTab } from '@/components/assets/DevicesTab';
import { DriversTab } from '@/components/assets/DriversTab';
import { GroupsTab } from '@/components/assets/GroupsTab';
import { VehiclesTab } from '@/components/assets/VehiclesTab';
import { ConfirmDialog } from '@/components/feedback/ConfirmDialog';
import { useToast } from '@/components/feedback/ToastProvider';
import { PageHeader } from '@/components/ui';
import type {
  DeviceStatus,
  DeviceType,
  DriverStatus,
  VehicleStatus,
} from '@/types/asset.types';
import type { VehicleType } from '@/types/fleet.types';
import { Box, Button, Stack, Tab, Tabs, Typography } from '@mui/material';
import { Plus } from 'lucide-react';

/** The four asset-class tabs. */
export type AssetTab = 'vehicles' | 'drivers' | 'devices' | 'groups';

const TABS: AssetTab[] = ['vehicles', 'drivers', 'devices', 'groups'];

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
  const [vStatus, setVStatus] = useState<VehicleStatus | 'all'>('all');
  const [vType, setVType] = useState<VehicleType | 'all'>('all');
  const [vQuery, setVQuery] = useState('');
  const [dStatus, setDStatus] = useState<DriverStatus | 'all'>('all');
  const [dQuery, setDQuery] = useState('');
  const [devStatus, setDevStatus] = useState<DeviceStatus | 'all'>('all');
  const [devType, setDevType] = useState<DeviceType | 'all'>('all');
  const [devQuery, setDevQuery] = useState('');

  const vehicles = useVehicles();
  const drivers = useDrivers();
  const devices = useDevices();
  const groups = useGroups();

  // Delete hooks (one per entity; dispatched by the active tab).
  const deleteVehicle = useDeleteVehicle();
  const deleteDriver = useDeleteDriver();
  const deleteDevice = useDeleteDevice();
  const deleteGroup = useDeleteGroup();
  const deleteMutation =
    tab === 'vehicles'
      ? deleteVehicle
      : tab === 'drivers'
        ? deleteDriver
        : tab === 'devices'
          ? deleteDevice
          : deleteGroup;

  // ── CRUD trigger state ──
  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<'create' | 'edit'>('create');
  const [editRecord, setEditRecord] = useState<AssetRecord | undefined>(undefined);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);

  // Tab counts for the tab badges.
  const counts = useMemo(
    () => ({
      vehicles: vehicles.data?.length ?? 0,
      drivers: drivers.data?.length ?? 0,
      devices: devices.data?.length ?? 0,
      groups: groups.data?.length ?? 0,
    }),
    [vehicles.data, drivers.data, devices.data, groups.data],
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

  // ── Delete handler (confirm → hook) ──
  // Resolve the record being deleted from the active registry to show its name.
  const deleteName = deleteTarget?.name ?? '';

  const onConfirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteMutation.mutateAsync(deleteTarget.id);
      toast.success(t('assets.crud.deleteSuccess', { name: deleteTarget.name }));
      setDeleteTarget(null);
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <Stack sx={{ height: '100%' }}>
      {/* Header */}
      <PageHeader
        compact
        title={t('assets.title')}
        subtitle={t('assets.subtitle')}
        actions={
          <Button variant="contained" size="small" startIcon={<Plus size={16} />} onClick={openCreate}>
            {t('common.add')} {t(`assets.tabs.${tab}`)}
          </Button>
        }
      />

      {/* Tabs */}
      <Tabs
        value={tab}
        onChange={(_, v) => setTab(v as AssetTab)}
        sx={{ borderBottom: 1, borderColor: 'divider' }}
      >
        {TABS.map((tb) => (
          <Tab
            key={tb}
            value={tb}
            label={
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                {t(`assets.tabs.${tb}`)}
                <Typography component="span" variant="caption" color="text.secondary">
                  ({counts[tb]})
                </Typography>
              </span>
            }
          />
        ))}
      </Tabs>

      {/* Active tab */}
      <Box sx={{ flex: 1, minHeight: 0, border: '1px solid', borderColor: 'divider', borderTop: 0 }}>
        {tab === 'vehicles' && (
          <VehiclesTab
            vehicles={vehicles.data ?? []}
            loading={vehicles.isLoading}
            selectedId={selectedId}
            onSelect={setSelectedId}
            filterStatus={vStatus}
            filterType={vType}
            query={vQuery}
            onFilterStatus={setVStatus}
            onFilterType={setVType}
            onQuery={setVQuery}
            onEdit={openEdit}
            onDelete={(id, name) => setDeleteTarget({ id, name })}
          />
        )}
        {tab === 'drivers' && (
          <DriversTab
            drivers={drivers.data ?? []}
            loading={drivers.isLoading}
            selectedId={selectedId}
            onSelect={setSelectedId}
            filterStatus={dStatus}
            query={dQuery}
            onFilterStatus={setDStatus}
            onQuery={setDQuery}
            onEdit={openEdit}
            onDelete={(id, name) => setDeleteTarget({ id, name })}
          />
        )}
        {tab === 'devices' && (
          <DevicesTab
            devices={devices.data ?? []}
            loading={devices.isLoading}
            selectedId={selectedId}
            onSelect={setSelectedId}
            filterStatus={devStatus}
            filterType={devType}
            query={devQuery}
            onFilterStatus={setDevStatus}
            onFilterType={setDevType}
            onQuery={setDevQuery}
            onEdit={openEdit}
            onDelete={(id, name) => setDeleteTarget({ id, name })}
          />
        )}
        {tab === 'groups' && (
          <GroupsTab
            groups={groups.data ?? []}
            loading={groups.isLoading}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onEdit={openEdit}
            onDelete={(id, name) => setDeleteTarget({ id, name })}
          />
        )}
      </Box>

      {/* Detail drawer for the active tab */}
      <AssetDetailDrawers tab={tab} selectedId={selectedId} onClose={() => setSelectedId(null)} />

      {/* Create / Edit form drawer */}
      <AssetFormDrawer
        open={formOpen}
        mode={formMode}
        entity={tab}
        record={editRecord}
        onClose={() => setFormOpen(false)}
      />

      {/* Delete confirmation */}
      <ConfirmDialog
        open={deleteTarget !== null}
        title={t('assets.crud.deleteConfirmTitle', { name: deleteName })}
        message={t('assets.crud.deleteConfirmBody')}
        loading={deleteMutation.isPending}
        onConfirm={onConfirmDelete}
        onClose={() => setDeleteTarget(null)}
      />
    </Stack>
  );
}
