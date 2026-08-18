/**
 * GeofencePage — TailAdmin geofence management (`/geofences`) — Sprint I
 * §45–§47, Phase 6 port.
 *
 * Paginated, filterable list (type / status / search) over GET /geofences,
 * a detail modal with map preview + lifecycle actions (edit geometry,
 * activate/deactivate, archive), and the create/edit form whose PRIMARY
 * interface is the map drawing surface. Mutations are gated on `maps.write`.
 * Geometry follows the backend exactly: CIRCLE (center+radius) and POLYGON —
 * nothing else.
 */
import { Archive, Circle as CircleIcon, Hexagon, Pencil, Plus, Power } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { fetchAllVehiclesAsMap } from '@/api/asset.api';
import { getApiErrorMessage } from '@/api/errors';
import {
  useArchiveGeofence,
  useGeofences,
  useGeofencesPage,
  useSetGeofenceStatus,
} from '@/api/geofence.api';
import { PermissionGate } from '@/auth/permissions';
import { ErrorState } from '@/components/common/ErrorState';
import { ConfirmDialog } from '@/components/feedback/ConfirmDialog';
import { useToast } from '@/components/feedback/ToastProvider';
import { GeofenceFormDialog } from '@/components/geofences/GeofenceFormDialog';
import { GeofencePreviewMap } from '@/components/geofences/GeofencePreviewMap';
import {
  Badge,
  Button,
  IconButton,
  Modal,
  Spinner,
  TBody,
  TD,
  TH,
  THead,
  Table,
  Tooltip,
} from '@/components/tailwind-ui';
import type { Geofence, GeofenceStatus, GeofenceType } from '@/types/geofence.types';

const TYPE_FILTERS: Array<{ value: '' | GeofenceType; labelKey: string }> = [
  { value: '', labelKey: 'geofences.filters.allTypes' },
  { value: 'CIRCLE', labelKey: 'geofences.circle' },
  { value: 'POLYGON', labelKey: 'geofences.polygon' },
];

const STATUS_FILTERS: Array<{ value: '' | GeofenceStatus | 'ARCHIVED'; labelKey: string }> = [
  { value: '', labelKey: 'geofences.filters.active' },
  { value: 'INACTIVE', labelKey: 'geofences.status.INACTIVE' },
  { value: 'ARCHIVED', labelKey: 'geofences.filters.archived' },
];

export function GeofencePage() {
  const { t } = useTranslation();
  const toast = useToast();
  const [typeFilter, setTypeFilter] = useState<'' | GeofenceType>('');
  const [statusFilter, setStatusFilter] = useState<'' | GeofenceStatus | 'ARCHIVED'>('');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [editTarget, setEditTarget] = useState<Geofence | null>(null);
  const [detailTarget, setDetailTarget] = useState<Geofence | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<Geofence | null>(null);

  const archive = useArchiveGeofence();

  const filters = useMemo(
    () => ({
      type: typeFilter || undefined,
      status: statusFilter === '' ? undefined : statusFilter,
      search: search || undefined,
      limit: 25,
    }),
    [typeFilter, statusFilter, search],
  );

  const page = useGeofencesPage(filters);
  const { data: overlays } = useGeofences();

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-gray-900 dark:text-white">
            {t('geofences.title')}
          </h1>
          <p className="text-sm text-gray-500 dark:text-graydark-600">{t('geofences.subtitle')}</p>
        </div>
        <PermissionGate requires="maps.write">
          <Button
            leftIcon={<Plus size={16} />}
            onClick={() => setShowCreate(true)}
            data-testid="geofence-create"
          >
            {t('geofences.create')}
          </Button>
        </PermissionGate>
      </div>

      {/* Filters (Sprint I §46) — native selects */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as '' | GeofenceType)}
          aria-label={t('geofences.filters.type')}
          className="h-9 cursor-pointer rounded-lg border border-gray-300 bg-white px-2.5 text-sm text-gray-700 focus:border-brand-500 focus:outline-none dark:border-white/10 dark:bg-graydark-300 dark:text-graydark-800"
        >
          {TYPE_FILTERS.map((f) => (
            <option key={f.value} value={f.value}>
              {t(f.labelKey)}
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as '' | GeofenceStatus | 'ARCHIVED')}
          aria-label={t('geofences.filters.status')}
          className="h-9 cursor-pointer rounded-lg border border-gray-300 bg-white px-2.5 text-sm text-gray-700 focus:border-brand-500 focus:outline-none dark:border-white/10 dark:bg-graydark-300 dark:text-graydark-800"
        >
          {STATUS_FILTERS.map((f) => (
            <option key={f.value} value={f.value}>
              {t(f.labelKey)}
            </option>
          ))}
        </select>
        <input
          placeholder={t('geofences.filters.search')}
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') setSearch(searchInput.trim());
          }}
          onBlur={() => setSearch(searchInput.trim())}
          aria-label={t('geofences.filters.search')}
          className="h-9 min-w-56 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-800 placeholder:text-gray-400 focus:border-brand-500 focus:outline-none dark:border-white/10 dark:bg-graydark-300 dark:text-graydark-800 dark:placeholder:text-graydark-600"
        />
      </div>

      {page.isLoading ? (
        <div className="flex justify-center py-12">
          <Spinner size="lg" label={t('common.loading')} />
        </div>
      ) : page.isError ? (
        <ErrorState error={page.error} onRetry={() => page.refetch()} />
      ) : (
        <>
          <Table caption={t('geofences.title')}>
            <THead>
              <tr>
                <TH>{t('geofences.cols.name')}</TH>
                <TH>{t('geofences.cols.type')}</TH>
                <TH>{t('geofences.cols.status')}</TH>
                <TH>{t('geofences.cols.vehicles')}</TH>
                <TH>{t('geofences.cols.alerts')}</TH>
                <TH>{t('geofences.cols.createdAt')}</TH>
              </tr>
            </THead>
            <TBody>
              {page.items.length === 0 ? (
                <tr>
                  <TD colSpan={6}>
                    <p className="py-8 text-center text-sm text-gray-500 dark:text-graydark-600">
                      {t('geofences.empty')}
                    </p>
                  </TD>
                </tr>
              ) : (
                page.items.map((g) => (
                  <tr
                    key={g.id}
                    tabIndex={0}
                    onClick={() => setDetailTarget(g)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') setDetailTarget(g);
                    }}
                    className="cursor-pointer transition-colors hover:bg-gray-50 dark:hover:bg-white/5"
                  >
                    <TD>
                      <span className="flex min-w-0 items-center gap-2">
                        {g.type === 'CIRCLE' ? (
                          <CircleIcon size={16} aria-hidden className="shrink-0 text-brand-500" />
                        ) : (
                          <Hexagon size={16} aria-hidden className="shrink-0 text-brand-500" />
                        )}
                        <span className="truncate font-semibold text-gray-800 dark:text-graydark-800">
                          {g.name || t('geofences.untitled')}
                        </span>
                      </span>
                    </TD>
                    <TD>
                      {g.type === 'CIRCLE'
                        ? t('geofences.circle')
                        : g.type === 'POLYGON'
                          ? t('geofences.polygon')
                          : g.type}
                    </TD>
                    <TD>
                      <Badge
                        color={
                          g.status === 'ACTIVE'
                            ? 'success'
                            : g.status === 'INACTIVE'
                              ? 'warning'
                              : 'gray'
                        }
                      >
                        {t(`geofences.status.${g.status}`)}
                      </Badge>
                    </TD>
                    <TD>
                      {g.assignedVehicleIds.length === 0 ? (
                        <Badge color="gray">{t('geofences.allVehicles')}</Badge>
                      ) : (
                        <Badge color="brand">
                          {t('geofences.nVehicles', { count: g.assignedVehicleIds.length })}
                        </Badge>
                      )}
                    </TD>
                    <TD>{g.alertOn.join(' · ')}</TD>
                    <TD>{g.createdAt ? new Date(g.createdAt).toLocaleDateString() : '—'}</TD>
                  </tr>
                ))
              )}
            </TBody>
          </Table>
          {page.hasNextPage && (
            <div className="flex justify-center">
              <Button
                variant="secondary"
                onClick={() => page.fetchNextPage()}
                disabled={page.isFetchingNextPage}
                data-testid="geofence-load-more"
              >
                {page.isFetchingNextPage ? t('common.loading') : t('common.loadMore')}
              </Button>
            </div>
          )}
        </>
      )}

      <GeofenceFormDialog
        open={showCreate || editTarget !== null}
        geofence={editTarget}
        onClose={() => {
          setShowCreate(false);
          setEditTarget(null);
        }}
      />
      <GeofenceDetailDialog
        geofence={detailTarget}
        onClose={() => setDetailTarget(null)}
        onEdit={(g) => {
          setDetailTarget(null);
          setEditTarget(g);
        }}
        onArchive={(g) => {
          setDetailTarget(null);
          setArchiveTarget(g);
        }}
      />
      <ConfirmDialog
        open={archiveTarget !== null}
        title={t('geofences.archiveTitle')}
        message={t('geofences.archiveBody', { name: archiveTarget?.name ?? '' })}
        confirmLabelKey="geofences.archive"
        tone="danger"
        loading={archive.isPending}
        onClose={() => setArchiveTarget(null)}
        onConfirm={() => {
          const target = archiveTarget;
          setArchiveTarget(null);
          if (!target) return;
          archive.mutate(target.id, {
            onSuccess: () =>
              toast.success(t('geofences.archived', { defaultValue: 'Geofence archived' })),
            onError: (err) => toast.error(getApiErrorMessage(err) ?? t('errors.generic')),
          });
        }}
      />
      {/* Overlay source consumed by the form's existing-fence rendering. */}
      <span hidden>{overlays?.length ?? 0}</span>
    </div>
  );
}

/** Detail modal — map preview + metadata + lifecycle actions (§47). */
function GeofenceDetailDialog({
  geofence,
  onClose,
  onEdit,
  onArchive,
}: {
  geofence: Geofence | null;
  onClose: () => void;
  onEdit: (g: Geofence) => void;
  onArchive: (g: Geofence) => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const setStatus = useSetGeofenceStatus();
  const [vehicleLabels, setVehicleLabels] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    if (!geofence || geofence.assignedVehicleIds.length === 0) return;
    let cancelled = false;
    void fetchAllVehiclesAsMap().then(({ vehicles }) => {
      if (cancelled) return;
      setVehicleLabels(new Map(vehicles.map((v) => [v.id, v.plate ?? v.name ?? v.code] as const)));
    });
    return () => {
      cancelled = true;
    };
  }, [geofence]);

  if (!geofence) return null;

  const toggleStatus = () => {
    const next: GeofenceStatus = geofence.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    setStatus.mutate(
      { id: geofence.id, status: next },
      {
        onSuccess: () =>
          toast.success(
            next === 'ACTIVE'
              ? t('geofences.activated', { defaultValue: 'Geofence activated' })
              : t('geofences.deactivated', { defaultValue: 'Geofence deactivated' }),
          ),
        onError: (err) => toast.error(getApiErrorMessage(err) ?? t('errors.generic')),
      },
    );
  };

  return (
    <Modal
      open={geofence !== null}
      onClose={onClose}
      size="lg"
      title={geofence.name || t('geofences.untitled')}
      footer={
        <>
          <PermissionGate requires="maps.write">
            <Tooltip label={t('geofences.toggleStatus')}>
              <IconButton
                aria-label={t('geofences.toggleStatus')}
                onClick={toggleStatus}
                disabled={setStatus.isPending}
                data-testid="geofence-toggle-status"
              >
                <Power
                  size={18}
                  color={geofence.status === 'ACTIVE' ? '#12B76A' : '#98A2B3'}
                  aria-hidden
                />
              </IconButton>
            </Tooltip>
            <Tooltip label={t('geofences.edit')}>
              <IconButton
                aria-label={t('geofences.edit')}
                onClick={() => onEdit(geofence)}
                data-testid="geofence-edit"
              >
                <Pencil size={18} aria-hidden />
              </IconButton>
            </Tooltip>
            <Tooltip label={t('geofences.archive')}>
              <IconButton
                aria-label={t('geofences.archive')}
                onClick={() => onArchive(geofence)}
                data-testid="geofence-archive"
              >
                <Archive size={18} aria-hidden />
              </IconButton>
            </Tooltip>
          </PermissionGate>
          <Button variant="secondary" onClick={onClose}>
            {t('common.close')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <GeofencePreviewMap geofence={geofence} height={320} />
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge color="brand">
            {geofence.type === 'CIRCLE'
              ? t('geofences.circle')
              : geofence.type === 'POLYGON'
                ? t('geofences.polygon')
                : geofence.type}
          </Badge>
          <Badge color={geofence.status === 'ACTIVE' ? 'success' : 'gray'}>
            {t(`geofences.status.${geofence.status}`)}
          </Badge>
          {geofence.type === 'CIRCLE' && geofence.radiusM !== null && (
            <Badge color="gray">
              {t('geofences.radiusM', { m: Math.round(geofence.radiusM) })}
            </Badge>
          )}
          {geofence.dwellSec !== null && (
            <Badge color="gray">{t('geofences.dwellBadge', { sec: geofence.dwellSec })}</Badge>
          )}
        </div>
        {geofence.description && (
          <p className="text-sm text-gray-500 dark:text-graydark-600">{geofence.description}</p>
        )}
        <div>
          <p className="text-xs font-semibold tracking-wide text-gray-400 uppercase dark:text-graydark-600">
            {t('geofences.assignedTo')}
          </p>
          {geofence.assignedVehicleIds.length === 0 ? (
            <p className="mt-1 text-sm text-gray-700 dark:text-graydark-700">
              {t('geofences.allVehicles')}
            </p>
          ) : (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {geofence.assignedVehicleIds.map((id) => (
                <Badge key={id} color="gray">
                  {vehicleLabels.get(id) ?? id.slice(0, 8)}
                </Badge>
              ))}
            </div>
          )}
        </div>
        <p className="text-xs text-gray-400 dark:text-graydark-600">
          {t('geofences.createdAt')}{' '}
          {geofence.createdAt ? new Date(geofence.createdAt).toLocaleString() : '—'} ·{' '}
          {t('geofences.updatedAt')}{' '}
          {geofence.updatedAt ? new Date(geofence.updatedAt).toLocaleString() : '—'}
        </p>
      </div>
    </Modal>
  );
}
