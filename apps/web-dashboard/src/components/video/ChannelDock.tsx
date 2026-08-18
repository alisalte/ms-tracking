/**
 * ChannelDock — the TailAdmin collapsible left panel listing all assignable
 * channels (Phase 7 port).
 *
 * Groups channels by source (sites → site cameras, vehicles → 4 cameras each).
 * Clicking a channel assigns it to the next free wall slot. Includes a search
 * box, an online-only filter, and an auto-fill action that populates every
 * empty slot. Mirrors the channel-picker contract in `10_Live_Vide.md` §7.3.
 */
import { Building2, Camera, ChevronRight, Search, Wand2, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/tailwind-ui';
import type { CameraChannel, CameraFacing } from '@/types/video.types';

/** Facing → i18n key. */
const FACING_KEY: Record<CameraFacing, string> = {
  forward: 'video.facing.forward',
  driver: 'video.facing.driver',
  rear: 'video.facing.rear',
  cargo: 'video.facing.cargo',
  site: 'video.facing.site',
};

interface ChannelDockProps {
  /** The full channel catalog. */
  channels: CameraChannel[];
  /** Assign a channel to the next free slot. */
  onPick: (channel: CameraChannel) => void;
  /** Fill every empty slot with channels (deterministic order). */
  onAutoFill: () => void;
}

export function ChannelDock({ channels, onPick, onAutoFill }: ChannelDockProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [onlineOnly, setOnlineOnly] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

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

  // Group by source label so the list is readable.
  const grouped = useMemo(() => {
    const m = new Map<string, CameraChannel[]>();
    for (const c of filtered) {
      const arr = m.get(c.sourceLabel) ?? [];
      arr.push(c);
      m.set(c.sourceLabel, arr);
    }
    return Array.from(m.entries());
  }, [filtered]);

  const toggleGroup = (key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div className="flex h-full w-[260px] min-w-[260px] flex-col overflow-hidden border-e border-gray-200 bg-white dark:border-white/5 dark:bg-graydark-300">
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
        <Button size="sm" variant="outline" leftIcon={<Wand2 size={15} />} onClick={onAutoFill}>
          {t('video.dock.autoFill')}
        </Button>
      </div>

      {/* Channel list grouped by source */}
      <div className="fv-scroll min-h-0 flex-1 overflow-y-auto">
        {grouped.length === 0 ? (
          <p className="p-4 text-xs text-gray-400 dark:text-graydark-600">
            {t('video.dock.noResults')}
          </p>
        ) : (
          grouped.map(([sourceLabel, cams]) => {
            const isCollapsed = collapsed.has(sourceLabel);
            return (
              <div key={sourceLabel}>
                <button
                  type="button"
                  onClick={() => toggleGroup(sourceLabel)}
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
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-gray-800 dark:text-graydark-800">
                    {sourceLabel}
                  </span>
                  <span className="inline-flex h-4 items-center rounded-full bg-gray-100 px-1.5 text-[0.6rem] font-semibold text-gray-500 dark:bg-white/5 dark:text-graydark-600">
                    {cams.length}
                  </span>
                  <ChevronRight
                    size={14}
                    aria-hidden
                    className={`shrink-0 text-gray-400 transition-transform rtl:rotate-180 ${isCollapsed ? '' : 'rotate-90'}`}
                  />
                </button>
                {!isCollapsed &&
                  cams.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => onPick(c)}
                      className={`flex w-full cursor-pointer items-center gap-2 border-none bg-transparent ps-8 pe-2.5 py-1 text-start transition-colors hover:bg-gray-50 dark:hover:bg-white/5 ${
                        c.online && c.consentGiven ? 'opacity-100' : 'opacity-50'
                      }`}
                    >
                      <span
                        aria-hidden
                        className="me-1 size-1.5 shrink-0 rounded-full"
                        style={{ background: c.online && c.consentGiven ? '#22d3ee' : '#64748b' }}
                      />
                      <span className="min-w-0 flex-1 truncate text-sm text-gray-700 dark:text-graydark-700">
                        {t(FACING_KEY[c.facing])}
                      </span>
                      {c.cabinCam && (
                        <span className="inline-flex h-3.5 items-center rounded-full bg-black/60 px-1.5 text-[0.55rem] font-semibold text-warning-400">
                          {t('video.tile.cabinCam')}
                        </span>
                      )}
                    </button>
                  ))}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
