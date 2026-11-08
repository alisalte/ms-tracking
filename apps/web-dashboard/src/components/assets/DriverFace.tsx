/**
 * DriverFace — a driver's face as the platform knows it from cabin photos.
 *
 *   DriverFaceAvatar   small round picture for tables (initials when no photo)
 *   DriverFaceSection  driver drawer block: profile photo, enrolment status,
 *                      click → gallery of the driver's kept photos (≤ 5)
 *
 * The platform keeps only each driver's newest 5 cabin photos; older ones are
 * dropped once the driver is recognised.
 */
import { ScanFace } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  type DriverFace,
  useDriverFaces,
  useDriverPhotoImage,
  useDriverPhotos,
} from '@/api/driver-photo.api';
import { Avatar, Badge, Modal, Spinner } from '@/components/tailwind-ui';
import { formatDateTime } from '@/lib/format-date';

/** Photos shown in a driver's gallery. */
export const DRIVER_GALLERY_SIZE = 5;

export function DriverFaceAvatar({
  face,
  name,
  size = 'sm',
}: {
  face: DriverFace | undefined;
  name: string;
  size?: 'sm' | 'md' | 'xl' | '2xl';
}) {
  const photoId = face?.profilePhotoId ?? '';
  const image = useDriverPhotoImage(photoId, Boolean(photoId));
  return <Avatar src={image.data} name={name} size={size} />;
}

export function DriverFaceSection({ driverId, name }: { driverId: string; name: string }) {
  const { t } = useTranslation();
  const face = useDriverFaces().data?.get(driverId);
  const [open, setOpen] = useState(false);
  const registered = (face?.references ?? 0) > 0;
  const hasPhotos = (face?.photos ?? 0) > 0;

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 disabled:cursor-default"
        onClick={() => setOpen(true)}
        disabled={!hasPhotos}
        aria-label={t('assets.driverPhotos.galleryOpen')}
        title={hasPhotos ? t('assets.driverPhotos.galleryOpen') : undefined}
      >
        <DriverFaceAvatar face={face} name={name} size="2xl" />
      </button>
      <div className="flex min-w-0 flex-col gap-1">
        {registered ? (
          <Badge color="success" dot>
            {t('assets.driverPhotos.faceRegistered')}
          </Badge>
        ) : (
          <Badge color="warning" dot>
            {t('assets.driverPhotos.faceNotRegistered')}
          </Badge>
        )}
        <span className="text-xs text-gray-500 dark:text-graydark-600">
          {registered
            ? t('assets.driverPhotos.faceRegisteredHint', { count: face?.photos ?? 0 })
            : t('assets.driverPhotos.faceNotRegisteredHint')}
        </span>
      </div>
      {open && <GalleryModal driverId={driverId} name={name} open onClose={() => setOpen(false)} />}
    </div>
  );
}

function GalleryModal({
  driverId,
  name,
  open,
  onClose,
}: {
  driverId: string;
  name: string;
  open: boolean;
  onClose: () => void;
}) {
  const { i18n } = useTranslation();
  const query = useDriverPhotos({ driverId, readyOnly: true, limit: DRIVER_GALLERY_SIZE });
  const photos = (query.data?.pages[0]?.data ?? []).slice(0, DRIVER_GALLERY_SIZE);
  const [active, setActive] = useState(0);
  const current = photos[Math.min(active, Math.max(0, photos.length - 1))];

  return (
    <Modal open={open} onClose={onClose} size="lg" title={name}>
      {query.isLoading ? (
        <div className="flex justify-center py-12">
          <Spinner />
        </div>
      ) : !current ? (
        <div className="flex flex-col items-center gap-2 py-12 text-gray-400">
          <ScanFace size={28} />
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <LargePhoto id={current.id} />
          <div className="text-sm text-gray-600 dark:text-graydark-700">
            {formatDateTime(current.capturedAt ?? current.triggeredAt, undefined, i18n.language)}
            {current.vehicleName ? ` · ${current.vehicleName}` : ''}
          </div>
          {photos.length > 1 && (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {photos.map((p, i) => (
                <Thumb
                  key={p.id}
                  id={p.id}
                  selected={p.id === current.id}
                  onClick={() => setActive(i)}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function LargePhoto({ id }: { id: string }) {
  const image = useDriverPhotoImage(id, true);
  return image.data ? (
    <img src={image.data} alt="" className="max-h-[60vh] w-full rounded-lg object-contain" />
  ) : (
    <div className="flex justify-center py-12">
      <Spinner />
    </div>
  );
}

function Thumb({ id, selected, onClick }: { id: string; selected: boolean; onClick: () => void }) {
  const image = useDriverPhotoImage(id, true);
  return (
    <button
      type="button"
      onClick={onClick}
      className={`aspect-[4/3] w-20 shrink-0 overflow-hidden rounded-md border-2 bg-gray-100 dark:bg-graydark-100 ${
        selected ? 'border-brand-500' : 'border-transparent'
      }`}
    >
      {image.data && <img src={image.data} alt="" className="h-full w-full object-cover" />}
    </button>
  );
}
