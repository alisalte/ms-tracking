/**
 * DriverPhotosPanel — cabin snapshots and who each one shows (Drivers tab →
 * "Driver photos").
 *
 * When a machine's ignition comes on, the MDVR's cabin camera takes a photo.
 * The operator files each photo under a driver (or moves it to another driver
 * when it was filed wrongly). Filed photos teach the platform each driver's
 * face; later photos are matched automatically and credit that driver with the
 * shift.
 */
import { Camera, Check, ImageOff, Loader2, Trash2, UserX } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  type DriverMatchStatus,
  type DriverPhoto,
  useAssignDriverPhoto,
  useCaptureDriverPhoto,
  useDeleteDriverPhoto,
  useDriverPhotoCounts,
  useDriverPhotoImage,
  useDriverPhotos,
} from '@/api/driver-photo.api';
import { driverFullName } from '@/api/driver.api';
import { PERMISSIONS, usePermissions } from '@/auth/permissions';
import { ErrorState } from '@/components/common/ErrorState';
import { useToast } from '@/components/feedback/ToastProvider';
import {
  Badge,
  Button,
  EmptyState,
  IconButton,
  LoadMoreButton,
  Modal,
  SegmentedControl,
  Select,
  Spinner,
} from '@/components/tailwind-ui';
import { formatDateTime } from '@/lib/format-date';
import type { Device, Driver } from '@/types/asset.types';

type View = 'UNASSIGNED' | 'AUTO' | 'CONFIRMED' | 'ALL';

interface DriverPhotosPanelProps {
  drivers: Driver[];
  devices: Device[];
}

function inFlight(p: DriverPhoto): boolean {
  return p.status === 'PENDING' || p.status === 'CAPTURING' || p.status === 'DOWNLOADING';
}

export function DriverPhotosPanel({ drivers, devices }: DriverPhotosPanelProps) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const { can } = usePermissions();
  const canWrite = can(PERMISSIONS.driverWrite);

  const [view, setView] = useState<View>('UNASSIGNED');
  const [driverFilter, setDriverFilter] = useState('');
  const [preview, setPreview] = useState<DriverPhoto | null>(null);
  const [captureOpen, setCaptureOpen] = useState(false);

  const filters = useMemo(
    () => ({
      matchStatus: view === 'ALL' ? undefined : (view as DriverMatchStatus),
      driverId: driverFilter || undefined,
      // The inbox only lists finished snapshots; "all" also shows the ones in flight.
      readyOnly: view === 'UNASSIGNED',
    }),
    [view, driverFilter],
  );
  const photosQuery = useDriverPhotos(filters);
  const countsQuery = useDriverPhotoCounts();
  const counts = countsQuery.data;
  const photos = photosQuery.data?.pages.flatMap((p) => p.data) ?? [];

  const assign = useAssignDriverPhoto();
  const remove = useDeleteDriverPhoto();

  const driverOptions = useMemo(
    () =>
      drivers
        .filter((d) => d.status === 'ACTIVE')
        .map((d) => ({ value: d.id, label: driverFullName(d) }))
        .sort((a, b) => a.label.localeCompare(b.label, i18n.language)),
    [drivers, i18n.language],
  );

  const onAssign = async (photo: DriverPhoto, driverId: string | null) => {
    try {
      const res = await assign.mutateAsync({ id: photo.id, driverId });
      if (driverId && res.rematched > 0) {
        toast.success(t('assets.driverPhotos.rematched', { count: res.rematched }));
      } else {
        toast.success(driverId ? 'assets.driverPhotos.assigned' : 'assets.driverPhotos.cleared');
      }
    } catch (err) {
      toast.error(err);
    }
  };

  const onDelete = async (photo: DriverPhoto) => {
    try {
      await remove.mutateAsync(photo.id);
      if (preview?.id === photo.id) setPreview(null);
      toast.success('assets.driverPhotos.deleted');
    } catch (err) {
      toast.error(err);
    }
  };

  const views: Array<{ value: View; label: string }> = [
    {
      value: 'UNASSIGNED',
      label: `${t('assets.driverPhotos.viewUnassigned')}${counts ? ` (${counts.unassigned})` : ''}`,
    },
    {
      value: 'AUTO',
      label: `${t('assets.driverPhotos.viewAuto')}${counts ? ` (${counts.auto})` : ''}`,
    },
    {
      value: 'CONFIRMED',
      label: `${t('assets.driverPhotos.viewConfirmed')}${counts ? ` (${counts.confirmed})` : ''}`,
    },
    { value: 'ALL', label: t('assets.driverPhotos.viewAll') },
  ];

  return (
    <div className="flex flex-col gap-3">
      <p className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600 dark:border-graydark-200 dark:bg-graydark-100 dark:text-graydark-700">
        {t('assets.driverPhotos.hint')}
      </p>

      <div className="flex flex-wrap items-end gap-2">
        <SegmentedControl
          aria-label={t('assets.driverPhotos.title')}
          size="sm"
          options={views}
          value={view}
          onChange={setView}
        />
        <Select
          aria-label={t('assets.driverPhotos.filterDriver')}
          wrapperClassName="w-full sm:w-56"
          value={driverFilter}
          onChange={(e) => setDriverFilter(e.target.value)}
          options={[{ value: '', label: t('assets.driverPhotos.allDrivers') }, ...driverOptions]}
        />
        {canWrite && (
          <Button
            size="sm"
            variant="outline"
            className="ms-auto"
            leftIcon={<Camera size={15} />}
            onClick={() => setCaptureOpen(true)}
            type="button"
          >
            {t('assets.driverPhotos.captureNow')}
          </Button>
        )}
      </div>

      {photosQuery.isError ? (
        <ErrorState error={photosQuery.error} onRetry={() => photosQuery.refetch()} />
      ) : photosQuery.isLoading ? (
        <div className="flex justify-center py-12">
          <Spinner />
        </div>
      ) : photos.length === 0 ? (
        <EmptyState
          icon={<Camera />}
          title={t('assets.driverPhotos.empty')}
          description={t('assets.driverPhotos.emptyHint')}
        />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-6">
            {photos.map((photo) => (
              <PhotoCard
                key={photo.id}
                photo={photo}
                driverOptions={driverOptions}
                canWrite={canWrite}
                busy={
                  (assign.isPending && assign.variables?.id === photo.id) ||
                  (remove.isPending && remove.variables === photo.id)
                }
                lang={i18n.language}
                onOpen={() => setPreview(photo)}
                onAssign={(driverId) => onAssign(photo, driverId)}
                onDelete={() => onDelete(photo)}
              />
            ))}
          </div>
          <LoadMoreButton
            hasNextPage={Boolean(photosQuery.hasNextPage)}
            isFetchingNextPage={photosQuery.isFetchingNextPage}
            onClick={() => photosQuery.fetchNextPage()}
          />
        </>
      )}

      <PreviewModal photo={preview} onClose={() => setPreview(null)} lang={i18n.language} />
      <CaptureModal open={captureOpen} onClose={() => setCaptureOpen(false)} devices={devices} />
    </div>
  );
}

// --------------------------------------------------------------------- card

interface PhotoCardProps {
  photo: DriverPhoto;
  driverOptions: Array<{ value: string; label: string }>;
  canWrite: boolean;
  busy: boolean;
  lang: string;
  onOpen: () => void;
  onAssign: (driverId: string | null) => void;
  onDelete: () => void;
}

function PhotoCard({
  photo,
  driverOptions,
  canWrite,
  busy,
  lang,
  onOpen,
  onAssign,
  onDelete,
}: PhotoCardProps) {
  const { t } = useTranslation();
  const ready = photo.status === 'READY';
  const image = useDriverPhotoImage(photo.id, ready);
  const machine = photo.vehicleName ?? photo.deviceImei ?? '—';

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-graydark-200 dark:bg-graydark-50">
      <button
        type="button"
        className="relative flex aspect-[4/3] items-center justify-center bg-gray-100 text-gray-400 dark:bg-graydark-100"
        onClick={ready ? onOpen : undefined}
        disabled={!ready}
        aria-label={t('assets.driverPhotos.open')}
      >
        {ready && image.data ? (
          <img src={image.data} alt="" className="h-full w-full object-cover" loading="lazy" />
        ) : inFlight(photo) ? (
          <span className="flex flex-col items-center gap-1 text-xs">
            <Loader2 className="animate-spin" size={20} />
            {t('assets.driverPhotos.capturing')}
          </span>
        ) : photo.status === 'FAILED' ? (
          <span
            className="flex flex-col items-center gap-1 px-2 text-center text-xs"
            title={photo.error ?? ''}
          >
            <ImageOff size={20} />
            {t('assets.driverPhotos.failed')}
          </span>
        ) : (
          <Loader2 className="animate-spin" size={20} />
        )}
        {ready && photo.faceStatus === 'NO_FACE' && (
          <span className="absolute start-2 top-2">
            <Badge color="warning">{t('assets.driverPhotos.noFace')}</Badge>
          </span>
        )}
      </button>

      <div className="flex flex-1 flex-col gap-2 p-3 text-sm">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate font-medium text-gray-900 dark:text-white" title={machine}>
              {machine}
            </div>
            <div className="text-xs text-gray-500 dark:text-graydark-600">
              {formatDateTime(photo.capturedAt ?? photo.triggeredAt, undefined, lang)} ·{' '}
              {t(`assets.driverPhotos.trigger.${photo.trigger}`)}
            </div>
          </div>
          <MatchBadge photo={photo} />
        </div>

        {ready &&
          (canWrite ? (
            <Select
              aria-label={t('assets.driverPhotos.chooseDriver')}
              value={photo.driverId ?? ''}
              placeholder={t('assets.driverPhotos.chooseDriver')}
              options={driverOptions}
              disabled={busy}
              onChange={(e) => {
                const next = e.target.value;
                if (next && next !== photo.driverId) onAssign(next);
              }}
            />
          ) : (
            <div className="text-gray-700 dark:text-graydark-800">{photo.driverName ?? '—'}</div>
          ))}

        {canWrite && (
          <div className="mt-auto flex items-center gap-1">
            {photo.matchStatus === 'AUTO' && photo.driverId && (
              <Button
                size="sm"
                variant="outline"
                leftIcon={<Check size={14} />}
                disabled={busy}
                onClick={() => onAssign(photo.driverId)}
                type="button"
              >
                {t('assets.driverPhotos.confirm')}
              </Button>
            )}
            {photo.driverId && (
              <IconButton
                aria-label={t('assets.driverPhotos.notThisDriver')}
                title={t('assets.driverPhotos.notThisDriver')}
                disabled={busy}
                onClick={() => onAssign(null)}
              >
                <UserX size={16} />
              </IconButton>
            )}
            <IconButton
              className="ms-auto"
              aria-label={t('assets.driverPhotos.delete')}
              title={t('assets.driverPhotos.delete')}
              disabled={busy}
              onClick={onDelete}
            >
              <Trash2 size={16} />
            </IconButton>
          </div>
        )}
      </div>
    </div>
  );
}

function MatchBadge({ photo }: { photo: DriverPhoto }) {
  const { t } = useTranslation();
  if (photo.status !== 'READY') return null;
  if (photo.matchStatus === 'CONFIRMED') {
    return <Badge color="success">{t('assets.driverPhotos.badgeConfirmed')}</Badge>;
  }
  if (photo.matchStatus === 'AUTO') {
    const pct = photo.matchScore != null ? Math.round(photo.matchScore * 100) : null;
    return (
      <Badge color="info" title={t('assets.driverPhotos.autoHint')}>
        {t('assets.driverPhotos.badgeAuto')}
        {pct != null ? ` ${pct}%` : ''}
      </Badge>
    );
  }
  return <Badge color="warning">{t('assets.driverPhotos.badgeUnassigned')}</Badge>;
}

// ------------------------------------------------------------------ dialogs

function PreviewModal({
  photo,
  onClose,
  lang,
}: {
  photo: DriverPhoto | null;
  onClose: () => void;
  lang: string;
}) {
  const { t } = useTranslation();
  const image = useDriverPhotoImage(photo?.id ?? '', Boolean(photo));
  return (
    <Modal
      open={Boolean(photo)}
      onClose={onClose}
      size="lg"
      title={photo ? (photo.vehicleName ?? photo.deviceImei ?? '') : ''}
    >
      {photo && (
        <div className="flex flex-col gap-2">
          {image.data ? (
            <img
              src={image.data}
              alt=""
              className="max-h-[70vh] w-full rounded-lg object-contain"
            />
          ) : (
            <div className="flex justify-center py-12">
              <Spinner />
            </div>
          )}
          <div className="text-sm text-gray-600 dark:text-graydark-700">
            {formatDateTime(photo.capturedAt ?? photo.triggeredAt, undefined, lang)}
            {photo.driverName ? ` · ${photo.driverName}` : ''}
            {photo.faceStatus === 'NO_FACE' ? ` · ${t('assets.driverPhotos.noFace')}` : ''}
          </div>
        </div>
      )}
    </Modal>
  );
}

function CaptureModal({
  open,
  onClose,
  devices,
}: {
  open: boolean;
  onClose: () => void;
  devices: Device[];
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const capture = useCaptureDriverPhoto();
  const [deviceId, setDeviceId] = useState('');
  const options = useMemo(
    () =>
      devices
        .filter((d) => d.protocol === 'meitrack' && d.status === 'ACTIVE')
        .map((d) => ({ value: d.id, label: d.imei })),
    [devices],
  );

  const submit = async () => {
    if (!deviceId) return;
    try {
      await capture.mutateAsync(deviceId);
      toast.success('assets.driverPhotos.captureQueued');
      onClose();
    } catch (err) {
      toast.error(err);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title={t('assets.driverPhotos.captureNow')}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose} type="button">
            {t('common.cancel')}
          </Button>
          <Button
            size="sm"
            onClick={submit}
            disabled={!deviceId}
            loading={capture.isPending}
            type="button"
          >
            {t('assets.driverPhotos.capture')}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-2">
        <p className="text-sm text-gray-600 dark:text-graydark-700">
          {t('assets.driverPhotos.captureHint')}
        </p>
        <Select
          label={t('assets.driverPhotos.device')}
          value={deviceId}
          placeholder={t('assets.driverPhotos.chooseDevice')}
          options={options}
          onChange={(e) => setDeviceId(e.target.value)}
        />
      </div>
    </Modal>
  );
}
