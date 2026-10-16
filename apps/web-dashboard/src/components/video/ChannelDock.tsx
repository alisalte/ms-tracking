/**
 * ChannelDock — the TailAdmin collapsible left panel listing all assignable
 * channels (Phase 7 port).
 *
 * Groups channels by source (vehicle / device). Clicking a channel assigns it
 * to the next free wall slot. Shows online status per device, which cameras
 * are already on the wall, and Auto-fill / Clear-all actions.
 */
import { Building2, Camera, Check, ChevronRight, Eraser, Search, Wand2, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/tailwind-ui';
import type { CameraChannel } from '@/types/video.types';

interface ChannelDockProps {
  /** The full channel catalog. */
  channels: CameraChannel[];
  /** Channel ids currently placed on the wall. */
  assignedIds?: ReadonlySet<string>;
  /** Assign a channel to the next free slot. */
  onPick: (channel: CameraChannel) => void;
  /** Fill every empty slot with channels (deterministic order). */
  onAutoFill: () => void;
  /** Remove every camera from the wall. */
  onClearWall?: () => void;
}

export function ChannelDock({
  channels,
  assignedIds,
  onPick,
  onAutoFill,
  onClearWall,
}: ChannelDockProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [onlineOnly, setOnlineOnly] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const onWall = assignedIds ?? new Set<string>();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return channels.filter((c) => {
      if (onlineOnly && (!c.online || !c.consentGiven)) return false;
      if (!q) return true;
      return (
        c.label.toLowerCase().includes(q) ||
        c.sourceLabel.toLowerCase().includes(q) ||
        (c.imei?.toLowerCase().includes(q) ?? false) ||
        c.id.toLowerCase().includes(q)
      );
    });
  }, [channels, query, onlineOnly]);

  // Group by vehicle/device so both MDVR cameras sit under one header.
  const grouped = useMemo(() => {
    const m = new Map<string, CameraChannel[]>();
    for (const c of filtered) {
      const key = c.sourceId || c.deviceId || c.sourceLabel;
      const arr = m.get(key) ?? [];
      arr.push(c);
      m.set(key, arr);
    }
    return Array.from(m.entries()).map(([key, cams]) => {
      const sorted = [...cams].sort(
        (a, b) =>
          (a.logicalChannel ?? 99) - (b.logicalChannel ?? 99) || a.label.localeCompare(b.label),
      );
      const onlineCount = sorted.filter((c) => c.online && c.consentGiven).length;
      const onWallCount = sorted.filter((c) => onWall.has(c.id)).length;
      return {
        key,
        label: sorted[0]?.sourceLabel || key,
        cams: sorted,
        onlineCount,
        onWallCount,
        anyOnline: onlineCount > 0,
      };
    });
  }, [filtered, onWall]);

  const toggleGroup = (key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const hasAssigned = onWall.size > 0;

  return (
    <div className="flex h-full w-[280px] min-w-[280px] flex-col overflow-hidden border-e border-gray-200 bg-white dark:border-white/5 dark:bg-graydark-300">
      {/* Header: search + actions */}
      <div className="flex flex-col gap-2 border-b border-gray-200 p-2.5 dark:border-white/5">
        <div className="flex items-center gap-2">
          <p className="flex-1 text-sm font-semibold text-gray-800 dark:text-white">
            {t('video.dock.title')}
          </p>
          <button
            type="button"
            onClick={() => setOnlineOnly((v) => !v)}
            aria-pressed={onlineOnly}
            title={t('video.dock.onlineOnly')}
            className={`h-6 cursor-pointer rounded-full border px-2.5 text-xs font-semibold transition-colors ${
              onlineOnly
                ? 'border-brand-500 bg-brand-500 text-white'
                : 'border-gray-300 bg-transparent text-gray-600 hover:bg-gray-50 dark:border-white/10 dark:text-graydark-700 dark:hover:bg-white/5'
            }`}
          >
            {t('video.dock.online')}
          </button>
        </div>
        <div className="flex h-8 items-center gap-1.5 rounded-lg bg-gray-100 px-2.5 dark:bg-white/5">
          <Search size={15} aria-hidden className="shrink-0 text-gray-400 dark:text-graydark-600" />
          <input
            placeholder={t('video.dock.search')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="channel search"
            className="h-full w-full min-w-0 bg-transparent text-sm text-gray-800 placeholder:text-gray-400 focus:outline-none dark:text-graydark-800 dark:placeholder:text-graydark-600"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="clear search"
              className="flex shrink-0 cursor-pointer border-none bg-transparent p-0 text-gray-400 hover:text-gray-600 dark:hover:text-graydark-700"
            >
              <X size={14} />
            </button>
          )}
        </div>
        <div className="flex gap-1.5">
          <Button
            size="sm"
            variant="outline"
            className="min-w-0 flex-1"
            leftIcon={<Wand2 size={15} />}
            onClick={onAutoFill}
          >
            {t('video.dock.autoFill')}
          </Button>
          {onClearWall && (
            <Button
              size="sm"
              variant="outline"
              className="min-w-0 flex-1"
              leftIcon={<Eraser size={15} />}
              onClick={onClearWall}
              disabled={!hasAssigned}
              data-testid="wall-clear-all"
              title={t('video.dock.clearWallHint')}
            >
              {t('video.dock.clearWall')}
            </Button>
          )}
        </div>
      </div>

      {/* Channel list grouped by source */}
      <div className="fv-scroll min-h-0 flex-1 overflow-y-auto">
        {grouped.length === 0 ? (
          <p className="p-4 text-xs text-gray-400 dark:text-graydark-600">
            {t('video.dock.noResults')}
          </p>
        ) : (
          grouped.map(({ key, label: sourceLabel, cams, onlineCount, onWallCount, anyOnline }) => {
            const isCollapsed = collapsed.has(key);
            return (
              <div key={key} data-testid={`dock-group-${key}`}>
                <button
                  type="button"
                  onClick={() => toggleGroup(key)}
                  aria-expanded={!isCollapsed}
                  className="flex w-full cursor-pointer items-center gap-2 border-none bg-transparent px-2.5 py-1.5 text-start transition-colors hover:bg-gray-50 dark:hover:bg-white/5"
                >
                  {cams[0]?.sourceType === 'site' ? (
                    <Building2
                      size={15}
                      aria-hidden
                      className="shrink-0 text-gray-500 dark:text-graydark-600"
                    />
                  ) : (
                    <Camera
                      size={15}
                      aria-hidden
                      className="shrink-0 text-gray-500 dark:text-graydark-600"
                    />
                  )}
                  <span
                    aria-hidden
                    className="size-2 shrink-0 rounded-full"
                    style={{ background: anyOnline ? '#22d3ee' : '#64748b' }}
                    title={anyOnline ? t('video.dock.deviceOnline') : t('video.dock.deviceOffline')}
                  />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-800 dark:text-graydark-800">
                    {sourceLabel}
                  </span>
                  {onWallCount > 0 && (
                    <span
                      className="inline-flex h-4 items-center rounded-full bg-brand-500/15 px-1.5 text-[0.6rem] font-semibold text-brand-600 dark:text-brand-300"
                      title={t('video.dock.onWallCount', { count: onWallCount })}
                    >
                      {t('video.dock.onWall', { count: onWallCount })}
                    </span>
                  )}
                  <span
                    className="inline-flex h-4 items-center rounded-full bg-gray-100 px-1.5 text-[0.6rem] font-semibold text-gray-500 dark:bg-white/5 dark:text-graydark-600"
                    title={t('video.dock.onlineCount', {
                      online: onlineCount,
                      total: cams.length,
                    })}
                  >
                    {onlineCount}/{cams.length}
                  </span>
                  <ChevronRight
                    size={14}
                    aria-hidden
                    className={`shrink-0 text-gray-400 transition-transform rtl:rotate-180 ${isCollapsed ? '' : 'rotate-90'}`}
                  />
                </button>
                {!isCollapsed &&
                  cams.map((c) => {
                    const assigned = onWall.has(c.id);
                    const live = c.online && c.consentGiven;
                    return (
                      <button
                        key={c.id}
                        type="button"
                        data-testid={`dock-channel-${c.id}`}
                        data-assigned={assigned ? '1' : '0'}
                        onClick={() => onPick(c)}
                        className={`flex w-full cursor-pointer items-center gap-2 border-none bg-transparent ps-8 pe-2.5 py-1 text-start transition-colors hover:bg-gray-50 dark:hover:bg-white/5 ${
                          live ? 'opacity-100' : 'opacity-50'
                        } ${assigned ? 'bg-brand-500/8 dark:bg-brand-500/10' : ''}`}
                      >
                        <span
                          aria-hidden
                          className="me-1 size-1.5 shrink-0 rounded-full"
                          style={{ background: live ? '#22d3ee' : '#64748b' }}
                        />
                        <span className="min-w-0 flex-1 truncate text-sm text-gray-700 dark:text-graydark-700">
                          {c.logicalChannel != null && !/^ch\s*\d+/i.test(c.label)
                            ? `CH${c.logicalChannel} · ${c.label}`
                            : c.label}
                        </span>
                        {assigned && (
                          <span
                            className="inline-flex items-center gap-0.5 text-[0.6rem] font-semibold text-brand-600 dark:text-brand-300"
                            title={t('video.dock.alreadyOnWall')}
                          >
                            <Check size={12} aria-hidden />
                            {t('video.dock.onWallShort')}
                          </span>
                        )}
                        {c.cabinCam && (
                          <span className="inline-flex h-3.5 items-center rounded-full bg-black/60 px-1.5 text-[0.55rem] font-semibold text-warning-400">
                            {t('video.tile.cabinCam')}
                          </span>
                        )}
                      </button>
                    );
                  })}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
