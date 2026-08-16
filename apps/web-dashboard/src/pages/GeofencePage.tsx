/**
 * GeofencePage — geofence management (`/geofences`) — Sprint I §45–§47.
 *
 * Paginated, filterable list (type / status / search) over GET /geofences,
 * a detail dialog with map preview + lifecycle actions (edit geometry,
 * activate/deactivate, archive), and the create/edit form whose PRIMARY
 * interface is the map drawing surface. Mutations are gated on `maps.write`.
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
import { type Column, DataTable, PageHeader, StatusBadge } from '@/components/ui';
import type { Geofence, GeofenceStatus, GeofenceType } from '@/types/geofence.types';
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  MenuItem,
  Select,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';

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

  const columns: Column<Geofence>[] = useMemo(
    () => [
      {
        id: 'name',
        headerKey: 'geofences.cols.name',
        render: (g) => (
          <Stack direction="row" alignItems="center" gap={1} minWidth={0}>
            {g.type === 'CIRCLE' ? (
              <CircleIcon size={16} color="#465FFB" />
            ) : (
              <Hexagon size={16} color="#465FFB" />
            )}
            <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>
              {g.name || t('geofences.untitled')}
            </Typography>
          </Stack>
        ),
      },
      {
        id: 'type',
        headerKey: 'geofences.cols.type',
        render: (g) =>
          g.type === 'CIRCLE'
            ? t('geofences.circle')
            : g.type === 'POLYGON'
              ? t('geofences.polygon')
              : g.type,
      },
      {
        id: 'status',
        headerKey: 'geofences.cols.status',
        render: (g) => (
          <StatusBadge
            label={t(`geofences.status.${g.status}`)}
            tone={
              g.status === 'ACTIVE' ? 'success' : g.status === 'INACTIVE' ? 'warning' : 'neutral'
            }
          />
        ),
      },
      {
        id: 'vehicles',
        headerKey: 'geofences.cols.vehicles',
        render: (g) =>
          g.assignedVehicleIds.length === 0 ? (
            <Chip size="small" label={t('geofences.allVehicles')} variant="outlined" />
          ) : (
            <Chip
              size="small"
              label={t('geofences.nVehicles', { count: g.assignedVehicleIds.length })}
            />
          ),
      },
      {
        id: 'alerts',
        headerKey: 'geofences.cols.alerts',
        render: (g) => g.alertOn.join(' · '),
      },
      {
        id: 'createdAt',
        headerKey: 'geofences.cols.createdAt',
        render: (g) => (g.createdAt ? new Date(g.createdAt).toLocaleDateString() : '—'),
      },
    ],
    [t],
  );

  return (
    <Stack gap={2}>
      <PageHeader
        title={t('geofences.title')}
        subtitle={t('geofences.subtitle')}
        actions={
          <PermissionGate requires="maps.write">
            <Button
              variant="contained"
              startIcon={<Plus size={16} />}
              onClick={() => setShowCreate(true)}
              data-testid="geofence-create"
            >
              {t('geofences.create')}
            </Button>
          </PermissionGate>
        }
      />

      {/* Filters (Sprint I §46) */}
      <Stack direction={{ xs: 'column', sm: 'row' }} gap={1} alignItems={{ sm: 'center' }}>
        <Select
          size="small"
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as '' | GeofenceType)}
          sx={{ minWidth: 140 }}
          aria-label={t('geofences.filters.type')}
        >
          {TYPE_FILTERS.map((f) => (
            <MenuItem key={f.value} value={f.value}>
              {t(f.labelKey)}
            </MenuItem>
          ))}
        </Select>
        <Select
          size="small"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as '' | GeofenceStatus | 'ARCHIVED')}
          sx={{ minWidth: 140 }}
          aria-label={t('geofences.filters.status')}
        >
          {STATUS_FILTERS.map((f) => (
            <MenuItem key={f.value} value={f.value}>
              {t(f.labelKey)}
            </MenuItem>
          ))}
        </Select>
        <TextField
          size="small"
          placeholder={t('geofences.filters.search')}
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') setSearch(searchInput.trim());
          }}
          onBlur={() => setSearch(searchInput.trim())}
          sx={{ minWidth: 220 }}
          slotProps={{ htmlInput: { 'aria-label': t('geofences.filters.search') } }}
        />
      </Stack>

      {page.isLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress />
        </Box>
      ) : page.isError ? (
        <ErrorState error={page.error} onRetry={() => page.refetch()} />
      ) : (
        <>
          <DataTable
            columns={columns}
            rows={page.items}
            rowKey={(g) => g.id}
            onRowClick={(g) => setDetailTarget(g)}
            emptyKey="geofences.empty"
            dense
          />
          {page.hasNextPage && (
            <Box sx={{ display: 'flex', justifyContent: 'center' }}>
              <Button
                onClick={() => page.fetchNextPage()}
                disabled={page.isFetchingNextPage}
                data-testid="geofence-load-more"
              >
                {page.isFetchingNextPage ? t('common.loading') : t('common.loadMore')}
              </Button>
            </Box>
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
    </Stack>
  );
}

/** Detail dialog — map preview + metadata + lifecycle actions (§47). */
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
    <Dialog open={geofence !== null} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{geofence.name || t('geofences.untitled')}</DialogTitle>
      <DialogContent>
        <Stack gap={2} sx={{ mt: 1 }}>
          <GeofencePreviewMap geofence={geofence} height={320} />
          <Stack direction="row" gap={1} flexWrap="wrap" alignItems="center">
            <Chip
              size="small"
              label={
                geofence.type === 'CIRCLE'
                  ? t('geofences.circle')
                  : geofence.type === 'POLYGON'
                    ? t('geofences.polygon')
                    : geofence.type
              }
            />
            <Chip
              size="small"
              label={t(`geofences.status.${geofence.status}`)}
              color={geofence.status === 'ACTIVE' ? 'success' : 'default'}
            />
            {geofence.type === 'CIRCLE' && geofence.radiusM !== null && (
              <Chip
                size="small"
                label={t('geofences.radiusM', { m: Math.round(geofence.radiusM) })}
              />
            )}
            {geofence.dwellSec !== null && (
              <Chip size="small" label={t('geofences.dwellBadge', { sec: geofence.dwellSec })} />
            )}
          </Stack>
          {geofence.description && (
            <Typography variant="body2" color="text.secondary">
              {geofence.description}
            </Typography>
          )}
          <Box>
            <Typography variant="caption" color="text.secondary">
              {t('geofences.assignedTo')}
            </Typography>
            {geofence.assignedVehicleIds.length === 0 ? (
              <Typography variant="body2">{t('geofences.allVehicles')}</Typography>
            ) : (
              <Stack direction="row" gap={0.5} flexWrap="wrap" sx={{ mt: 0.5 }}>
                {geofence.assignedVehicleIds.map((id) => (
                  <Chip key={id} size="small" label={vehicleLabels.get(id) ?? id.slice(0, 8)} />
                ))}
              </Stack>
            )}
          </Box>
          <Typography variant="caption" color="text.secondary">
            {t('geofences.createdAt')}{' '}
            {geofence.createdAt ? new Date(geofence.createdAt).toLocaleString() : '—'} ·{' '}
            {t('geofences.updatedAt')}{' '}
            {geofence.updatedAt ? new Date(geofence.updatedAt).toLocaleString() : '—'}
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <PermissionGate requires="maps.write">
          <Tooltip title={t('geofences.toggleStatus')}>
            <IconButton
              aria-label={t('geofences.toggleStatus')}
              onClick={toggleStatus}
              disabled={setStatus.isPending}
              data-testid="geofence-toggle-status"
            >
              <Power size={18} color={geofence.status === 'ACTIVE' ? '#12B76A' : '#98A2B3'} />
            </IconButton>
          </Tooltip>
          <Tooltip title={t('geofences.edit')}>
            <IconButton
              aria-label={t('geofences.edit')}
              onClick={() => onEdit(geofence)}
              data-testid="geofence-edit"
            >
              <Pencil size={18} />
            </IconButton>
          </Tooltip>
          <Tooltip title={t('geofences.archive')}>
            <IconButton
              aria-label={t('geofences.archive')}
              onClick={() => onArchive(geofence)}
              data-testid="geofence-archive"
            >
              <Archive size={18} />
            </IconButton>
          </Tooltip>
        </PermissionGate>
        <Button onClick={onClose}>{t('common.close')}</Button>
      </DialogActions>
    </Dialog>
  );
}
