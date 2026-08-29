/**
 * CamerasPanel — camera/channel management table (Phase 7).
 *
 * One row per channel from the REAL media-service catalog (`GET /channels`):
 * camera label, channel id, owning vehicle/site, facing, online status,
 * consent (cabin-cam privacy gate), recording, and stream availability
 * (online + consent). "Add to wall" assigns the channel to the next free
 * wall slot. Search + online-only filter; honest empty state.
 */
import { Camera, Plus, Search, Video } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  Badge,
  Button,
  Card,
  EmptyState,
  Spinner,
  TBody,
  TD,
  TH,
  THead,
  Table,
  Tooltip,
} from '@/components/tailwind-ui';
import { displayLabel } from '@/lib/ids';
import type { CameraChannel } from '@/types/video.types';

interface CamerasPanelProps {
  channels: CameraChannel[];
  loading: boolean;
  /** Assign a channel to the next free wall slot. */
  onAddToWall: (channel: CameraChannel) => void;
}

export function CamerasPanel({ channels, loading, onAddToWall }: CamerasPanelProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [onlineOnly, setOnlineOnly] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return channels.filter((c) => {
      if (onlineOnly && (!c.online || !c.consentGiven)) return false;
      if (!q) return true;
      return (
        c.label.toLowerCase().includes(q) ||
        c.sourceLabel.toLowerCase().includes(q) ||
        c.id.toLowerCase().includes(q)
      );
    });
  }, [channels, query, onlineOnly]);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center py-16">
        <Spinner size="lg" label={t('common.loading')} />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
      {/* Filter row */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex h-9 min-w-64 items-center gap-2 rounded-lg bg-gray-100 px-3 dark:bg-white/5">
          <Search size={15} aria-hidden className="shrink-0 text-gray-400 dark:text-graydark-600" />
          <input
            placeholder={t('video.dock.search')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="camera search"
            className="h-full w-full min-w-0 bg-transparent text-sm text-gray-800 placeholder:text-gray-400 focus:outline-none dark:text-graydark-800 dark:placeholder:text-graydark-600"
          />
        </div>
        <button
          type="button"
          onClick={() => setOnlineOnly((v) => !v)}
          aria-pressed={onlineOnly}
          className={`h-9 cursor-pointer rounded-lg border px-3 text-sm font-semibold transition-colors ${
            onlineOnly
              ? 'border-brand-500 bg-brand-500 text-white'
              : 'border-gray-300 bg-transparent text-gray-600 hover:bg-gray-50 dark:border-white/10 dark:text-graydark-700 dark:hover:bg-white/5'
          }`}
        >
          {t('video.dock.online')}
        </button>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<Camera />}
          title={t('video.cameras.empty', { defaultValue: 'No cameras found' })}
          description={t('video.cameras.emptyHelp', {
            defaultValue: 'Channels appear here as devices register with the media service.',
          })}
        />
      ) : (
        <Card flush>
          <Table caption={t('video.cameras.title')}>
            <THead>
              <tr>
                <TH>{t('video.cameras.camera', { defaultValue: 'Camera' })}</TH>
                <TH>{t('video.cameras.channel', { defaultValue: 'Channel' })}</TH>
                <TH>{t('video.cameras.vehicle', { defaultValue: 'Vehicle / Site' })}</TH>
                <TH>{t('video.cameras.status', { defaultValue: 'Status' })}</TH>
                <TH>{t('video.cameras.stream', { defaultValue: 'Stream' })}</TH>
                <TH align="end">{t('common.actions')}</TH>
              </tr>
            </THead>
            <TBody>
              {filtered.map((c) => {
                const available = c.online && c.consentGiven;
                const channelId = displayLabel(c.id);
                return (
                  <tr key={c.id}>
                    <TD>
                      <span className="flex min-w-0 items-center gap-2">
                        <Video
                          size={15}
                          aria-hidden
                          className="shrink-0 text-gray-400 dark:text-graydark-600"
                        />
                        <span className="truncate font-semibold text-gray-800 dark:text-graydark-800">
                          {c.label}
                        </span>
                        {c.cabinCam && <Badge color="warning">{t('video.tile.cabinCam')}</Badge>}
                      </span>
                    </TD>
                    <TD>
                      {channelId ? (
                        <code className="font-mono text-xs text-gray-500 dark:text-graydark-600">
                          {channelId}
                        </code>
                      ) : (
                        <span className="text-xs text-gray-400 dark:text-graydark-600">—</span>
                      )}
                    </TD>
                    <TD>{c.sourceLabel}</TD>
                    <TD>
                      <div className="flex flex-wrap gap-1">
                        <Badge color={c.online ? 'success' : 'gray'}>
                          {c.online
                            ? t('video.cameras.online', { defaultValue: 'Online' })
                            : t('video.cameras.offline', { defaultValue: 'Offline' })}
                        </Badge>
                        {!c.consentGiven && (
                          <Tooltip label={t('video.tile.noConsent')}>
                            <Badge color="danger">
                              {t('video.cameras.noConsent', { defaultValue: 'No consent' })}
                            </Badge>
                          </Tooltip>
                        )}
                        {c.recordingActive && <Badge color="danger">REC</Badge>}
                      </div>
                    </TD>
                    <TD>
                      <Badge color={available ? 'success' : 'gray'}>
                        {available
                          ? t('video.cameras.available', { defaultValue: 'Available' })
                          : t('video.cameras.unavailable', { defaultValue: 'Unavailable' })}
                      </Badge>
                    </TD>
                    <TD align="end">
                      <Tooltip
                        label={t('video.cameras.addToWall', { defaultValue: 'Add to wall' })}
                      >
                        <Button
                          size="sm"
                          variant="outline"
                          leftIcon={<Plus size={14} />}
                          disabled={!available}
                          onClick={() => onAddToWall(c)}
                        >
                          {t('video.cameras.addToWall', { defaultValue: 'Add to wall' })}
                        </Button>
                      </Tooltip>
                    </TD>
                  </tr>
                );
              })}
            </TBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
