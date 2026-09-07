/**
 * AlarmPhotoCapture — take a fresh still from the vehicle's camera while
 * reviewing an alarm (D03 capture → D00 download).
 *
 * This is the on-demand path, not saved evidence: it asks the unit for a NEW
 * photo now, over the plain command channel, so it works even when live video
 * cannot dial back. The JPEG is shown inline and can be downloaded.
 */
import { Camera, Download } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button, Spinner } from '@/components/tailwind-ui';
import { useMdvrCapture } from '@/hooks/useMdvrCapture';
import { downloadBlob } from '@/lib/video-stream';
import type { CameraChannel } from '@/types/video.types';

interface AlarmPhotoCaptureProps {
  /** The vehicle's MDVR channels (already filtered + sorted by the caller). */
  channels: CameraChannel[];
}

/** Prefer a cabin/driver-facing camera when the catalog identifies one. */
function defaultChannel(channels: CameraChannel[]): CameraChannel | null {
  return channels.find((c) => c.cabinCam || c.facing === 'driver') ?? channels[0] ?? null;
}

export function AlarmPhotoCapture({ channels }: AlarmPhotoCaptureProps) {
  const { t } = useTranslation();
  const capture = useMdvrCapture();
  const [channelId, setChannelId] = useState<string>(() => defaultChannel(channels)?.id ?? '');

  const selected = channels.find((c) => c.id === channelId) ?? defaultChannel(channels);
  if (!selected?.deviceId) return null;

  const camera = selected.logicalChannel ?? 1;
  const busy = capture.status === 'capturing';

  return (
    <div className="mt-3 rounded-lg border border-gray-200 p-2.5 dark:border-white/10">
      <p className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 dark:text-graydark-600">
        <Camera size={14} aria-hidden />
        {t('alarms.detail.capture.title')}
      </p>
      <p className="mt-1 text-xs text-gray-400 dark:text-graydark-600">
        {t('alarms.detail.capture.hint')}
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {channels.length > 1 && (
          <label className="flex items-center gap-1.5">
            <span className="sr-only">{t('alarms.detail.capture.camera')}</span>
            <select
              value={selected.id}
              disabled={busy}
              onChange={(e) => setChannelId(e.target.value)}
              aria-label={t('alarms.detail.capture.camera')}
              data-testid="alarm-capture-camera"
              className="h-8 cursor-pointer rounded-lg border border-gray-300 bg-white px-2 text-sm text-gray-700 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:bg-graydark-300 dark:text-graydark-800"
            >
              {channels.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={busy}
          leftIcon={<Camera size={14} aria-hidden />}
          data-testid="alarm-capture-button"
          onClick={() => selected.deviceId && capture.capture(selected.deviceId, camera)}
        >
          {t(
            capture.status === 'ready'
              ? 'alarms.detail.capture.retake'
              : 'alarms.detail.capture.action',
          )}
        </Button>
      </div>

      {busy && (
        <div className="mt-2 flex items-center gap-2 text-sm text-gray-500 dark:text-graydark-600">
          <Spinner size="sm" />
          {t('alarms.detail.capture.capturing')}
        </div>
      )}

      {capture.status === 'error' && (
        <p className="mt-2 text-sm text-warning-600" data-testid="alarm-capture-error">
          {t('alarms.detail.capture.failed', { message: capture.error ?? '' })}
        </p>
      )}

      {capture.status === 'ready' && capture.url && (
        <div className="mt-2 overflow-hidden rounded-lg bg-gray-100 dark:bg-white/5">
          <img
            src={capture.url}
            alt={capture.filename ?? t('alarms.detail.capture.title')}
            data-testid="alarm-capture-photo"
            className="max-h-64 w-full object-contain"
          />
          <div className="flex items-center justify-between gap-2 px-2 py-1.5">
            <span className="min-w-0 truncate text-xs text-gray-500 dark:text-graydark-600">
              {capture.filename}
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              leftIcon={<Download size={14} aria-hidden />}
              onClick={() =>
                capture.blob && downloadBlob(capture.blob, capture.filename ?? 'capture.jpg')
              }
            >
              {t('alarms.detail.downloadPhoto')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
