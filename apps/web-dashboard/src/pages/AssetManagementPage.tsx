/**
 * AssetManagementPage — the consolidated fleet-asset registry (`/assets`).
 *
 * Four tabs — Vehicles · Drivers · Devices · Groups — over the operational
 * asset entity models (Fleet/Driver/Telemetry module docs). Shared search is
 * per-tab (the active tab owns its filter state); the active tab + selection
 * sync to the URL (`?tab=vehicles`) for shareable deep links. The existing
 * `/vehicles` and `/drivers` nav items redirect here.
 */
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';

import { useDevices, useDrivers, useGroups, useVehicles } from '@/api/asset.api';
import { AssetDetailDrawers } from '@/components/assets/AssetDetailDrawers';
import { DevicesTab } from '@/components/assets/DevicesTab';
import { DriversTab } from '@/components/assets/DriversTab';
import { GroupsTab } from '@/components/assets/GroupsTab';
import { VehiclesTab } from '@/components/assets/VehiclesTab';
import { PageHeader } from '@/components/ui';
import type { DeviceStatus, DeviceType, DriverStatus, VehicleStatus } from '@/types/asset.types';
import type { VehicleType } from '@/types/fleet.types';
import { Box, Stack, Tab, Tabs, Typography } from '@mui/material';

/** The four asset-class tabs. */
export type AssetTab = 'vehicles' | 'drivers' | 'devices' | 'groups';

const TABS: AssetTab[] = ['vehicles', 'drivers', 'devices', 'groups'];

/** Clamp the tab from URL params to a valid tab (default: vehicles). */
function readTab(value: string | null): AssetTab {
  return (TABS as readonly string[]).includes(value ?? '') ? (value as AssetTab) : 'vehicles';
}

export function AssetManagementPage() {
  const { t } = useTranslation();
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

  return (
    <Stack sx={{ height: '100%' }}>
      {/* Header */}
      <PageHeader
        compact
        title={t('assets.title')}
        subtitle={t('assets.subtitle')}
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
      <Box
        sx={{ flex: 1, minHeight: 0, border: '1px solid', borderColor: 'divider', borderTop: 0 }}
      >
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
          />
        )}
        {tab === 'groups' && (
          <GroupsTab
            groups={groups.data ?? []}
            loading={groups.isLoading}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        )}
      </Box>

      {/* Detail drawer for the active tab */}
      <AssetDetailDrawers tab={tab} selectedId={selectedId} onClose={() => setSelectedId(null)} />
    </Stack>
  );
}
