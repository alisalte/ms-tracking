/**
 * DriversTab — the driver registry table (REAL fleet-service contract).
 *
 * Columns: Name · License · Vehicle · Device · Status · Expiry. Filters: status +
 * free-text. Row click opens the driver detail drawer; write actions gated
 * by `fleet.driver.update` (deactivate uses `fleet.driver.manage` on the
 * backend; fleet-admin holds both).
 */
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { driverFullName } from '@/api/driver.api';
import { PERMISSIONS } from '@/auth/permissions';
import { AssetRowActions } from '@/components/assets/AssetRowActions';
import { driverStatusColor } from '@/components/assets/asset-meta';
import { devicesOnVehicle, formatDeviceLabel } from '@/components/assets/driver-join';
import {
  Badge,
  DataTable,
  EmptyState,
  Select,
  type TableColumn,
  Toolbar,
} from '@/components/tailwind-ui';
import type { Device, Driver, DriverStatus, Vehicle } from '@/types/asset.types';
import { UserRound } from 'lucide-react';

interface DriversTabProps {
  drivers: Driver[];
  vehicles: Vehicle[];
  /** Device registry — resolves assigned vehicle → bound tracker IMEI. */
  devices: Device[];
  loading?: boolean;
  selectedId?: string | null;
  onSelect: (id: string) => void;
  filterStatus: DriverStatus | 'all';
  query: string;
  onFilterStatus: (s: DriverStatus | 'all') => void;
  onQuery: (q: string) => void;
  onEdit?: (driver: Driver) => void;
  onDelete?: (id: string, name: string) => void;
}

const STATUSES: Array<DriverStatus | 'all'> = [
  'all',
  'ACTIVE',
  'INACTIVE',
  'SUSPENDED',
  'TERMINATED',
];

const EXPIRY_WARN_MS = 30 * 86_400_000;

export function DriversTab({
  drivers,
  vehicles,
  devices,
  loading = false,
  selectedId,
  onSelect,
  filterStatus,
  query,
  onFilterStatus,
  onQuery,
  onEdit,
  onDelete,
}: DriversTabProps) {
  const { t } = useTranslation();

  const vehicleName = useMemo(() => {
    const byId = new Map(vehicles.map((v) => [v.id, v] as const));
    return (id: string | null): string => (id ? (byId.get(id)?.name ?? '—') : '—');
  }, [vehicles]);

  const devicesOf = useMemo(
    () => (vehicleId: string | null) => devicesOnVehicle(devices, vehicleId),
    [devices],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return drivers.filter((d) => {
      if (filterStatus !== 'all' && d.status !== filterStatus) return false;
      if (!q) return true;
      const bound = devicesOf(d.assignedVehicleId);
      return (
        driverFullName(d).toLowerCase().includes(q) ||
        (d.email?.toLowerCase().includes(q) ?? false) ||
        d.licenseNumber.toLowerCase().includes(q) ||
        (d.employeeId?.toLowerCase().includes(q) ?? false) ||
        vehicleName(d.assignedVehicleId).toLowerCase().includes(q) ||
        bound.some(
          (dev) =>
            dev.imei.toLowerCase().includes(q) ||
            (dev.serialNumber?.toLowerCase().includes(q) ?? false),
        )
      );
    });
  }, [drivers, filterStatus, query, devicesOf, vehicleName]);

  const columns: Array<TableColumn<Driver>> = [
    {
      id: 'name',
      headerKey: 'assets.driver.colName',
      sortBy: (d) => driverFullName(d),
      render: (d) => (
        <span className="font-medium text-gray-800 dark:text-graydark-800">
          {driverFullName(d)}
        </span>
      ),
    },
    {
      id: 'license',
      headerKey: 'assets.driver.colLicense',
      sortBy: (d) => d.licenseNumber,
      render: (d) => {
        const expiringSoon =
          d.licenseExpires != null &&
          new Date(d.licenseExpires).getTime() - Date.now() < EXPIRY_WARN_MS;
        return (
          <div className="flex flex-col">
            <span className="font-mono text-xs">
              {[d.licenseClass, d.licenseNumber].filter(Boolean).join(' · ')}
            </span>
            {d.licenseExpires && (
              <span
                className={
                  expiringSoon
                    ? 'text-xs text-danger-600 dark:text-danger-400'
                    : 'text-xs text-gray-500 dark:text-graydark-600'
                }
              >
                {t('assets.driver.licenseExpiry')}:{' '}
                {new Date(d.licenseExpires).toLocaleDateString()}
              </span>
            )}
          </div>
        );
      },
    },
    {
      id: 'vehicle',
      headerKey: 'assets.driver.colVehicle',
      render: (d) =>
        d.assignedVehicleId ? (
          vehicleName(d.assignedVehicleId)
        ) : (
          <span className="text-gray-400 dark:text-graydark-600">{t('map.popup.unassigned')}</span>
        ),
    },
    {
      id: 'device',
      headerKey: 'assets.driver.colDevice',
      render: (d) => {
        const bound = devicesOf(d.assignedVehicleId);
        if (bound.length === 0) {
          return (
            <span className="text-gray-400 dark:text-graydark-600">
              {d.assignedVehicleId ? t('assets.driver.noDevice') : t('map.popup.unassigned')}
            </span>
          );
        }
        return (
          <div className="flex flex-col">
            {bound.map((dev) => (
              <span key={dev.id} className="font-mono text-xs">
                {formatDeviceLabel(dev)}
              </span>
            ))}
          </div>
        );
      },
    },
    {
      id: 'status',
      headerKey: 'assets.driver.colStatus',
      sortBy: (d) => d.status,
      render: (d) => (
        <Badge color={driverStatusColor(d.status)} dot>
          {t(`assets.driver.status.${d.status}`)}
        </Badge>
      ),
    },
    {
      id: 'actions',
      header: t('common.actions'),
      align: 'end',
      render: (d) => (
        <AssetRowActions
          record={d}
          writePermission={PERMISSIONS.driverWrite}
          onView={(driver) => onSelect(driver.id)}
          onEdit={onEdit}
          onDelete={
            onDelete && d.status !== 'TERMINATED' && d.status !== 'INACTIVE'
              ? (driver) => onDelete(driver.id, driverFullName(driver))
              : undefined
          }
          deleteIcon="deactivate"
        />
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      <Toolbar
        search
        searchValue={query}
        onSearchChange={onQuery}
        searchPlaceholder={t('assets.driver.search')}
        left={
          <Select
            value={filterStatus}
            onChange={(e) => onFilterStatus(e.target.value as DriverStatus | 'all')}
            wrapperClassName="w-40"
            aria-label={t('assets.driver.colStatus')}
            options={STATUSES.map((s) => ({
              value: s,
              label: s === 'all' ? t('assets.filters.allStatus') : t(`assets.driver.status.${s}`),
            }))}
          />
        }
        right={
          <span className="text-xs text-gray-500 dark:text-graydark-600">
            {t('assets.count', { count: filtered.length })}
          </span>
        }
      />
      <DataTable
        rows={filtered}
        columns={columns}
        rowKey={(d) => d.id}
        loading={loading}
        selectedKey={selectedId}
        onRowClick={(d) => onSelect(d.id)}
        maxHeight="calc(100vh - 320px)"
        emptyState={
          <EmptyState
            icon={<UserRound />}
            title={t('assets.empty')}
            description={t('assets.driver.emptyDescription')}
          />
        }
      />
    </div>
  );
}
