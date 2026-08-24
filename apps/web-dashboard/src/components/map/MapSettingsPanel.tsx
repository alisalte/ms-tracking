import { Check, Layers } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { BASEMAPS, type BasemapId } from '@/lib/basemaps';

interface MapSettingsPanelProps {
  /** Active basemap style id. */
  basemap: BasemapId;
  onBasemapChange: (basemap: BasemapId) => void;
  /** Lift the button above the history playback transport while it runs. */
  raised?: boolean;
}

/**
 * MapSettingsPanel — Tailwind floating map-settings control (ported off MUI),
 * kept SEPARATE from the top tracking toolbar: a small layers button at the
 * bottom-start corner of the map opens a popover with the basemap display
 * modes (streets / satellite / dark / topo).
 *
 * The option list is a WAI-ARIA radiogroup (each item carries role=radio +
 * aria-checked); the popover closes on outside click or Escape but stays open
 * on selection so modes can be flipped quickly.
 */
export function MapSettingsPanel({
  basemap,
  onBasemapChange,
  raised = false,
}: MapSettingsPanelProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Outside-click close (the map canvas keeps receiving normal pans/zooms).
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div
      ref={rootRef}
      className={`absolute start-3 z-20 transition-[bottom] duration-200 ${raised ? 'bottom-[4.75rem]' : 'bottom-3'}`}
    >
      <button
        type="button"
        aria-label={t('map.settings.open')}
        title={t('map.settings.open')}
        data-testid="map-settings-button"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex size-9 cursor-pointer items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-600 shadow-lg transition-colors hover:bg-gray-50 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 dark:border-white/10 dark:bg-graydark-300 dark:text-graydark-700 dark:hover:bg-white/10 dark:hover:text-white"
      >
        <Layers size={17} aria-hidden />
      </button>
      {open && (
        <div
          data-testid="map-settings-popover"
          // biome-ignore lint/a11y/useSemanticElements: styled popover has no single semantic element.
          role="dialog"
          aria-label={t('map.settings.open')}
          className="absolute bottom-full start-0 mb-2 w-60 rounded-2xl border border-gray-200 bg-white p-1.5 shadow-xl dark:border-white/10 dark:bg-graydark-300"
        >
          <p className="px-2 pt-1 pb-1.5 text-xs font-bold tracking-[0.08em] text-gray-500 uppercase dark:text-graydark-600">
            {t('map.settings.basemap')}
          </p>
          <div
            role="radiogroup"
            aria-label={t('map.settings.basemap')}
            data-testid="map-settings-basemaps"
          >
            {BASEMAPS.map((bm) => {
              const active = bm.id === basemap;
              return (
                // ARIA radio pattern on a styled button: a native radio would
                // break the popover's keyboard interaction and visual style.
                <button
                  key={bm.id}
                  type="button"
                  // biome-ignore lint/a11y/useSemanticElements: popover-styled radio group
                  role="radio"
                  aria-checked={active}
                  data-testid={`basemap-option-${bm.id}`}
                  onClick={() => onBasemapChange(bm.id)}
                  className={`flex w-full cursor-pointer items-center gap-2.5 rounded-xl p-1.5 text-start text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 ${
                    active
                      ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300'
                      : 'text-gray-700 hover:bg-gray-100 dark:text-graydark-700 dark:hover:bg-white/5'
                  }`}
                >
                  <span
                    aria-hidden
                    className={`h-7 w-9 shrink-0 rounded-lg shadow-[inset_0_0_0_1px_rgba(0,0,0,0.08)] bg-gradient-to-br ${bm.swatchClass}`}
                  />
                  <span className="min-w-0 flex-1 truncate font-medium">{t(bm.labelKey)}</span>
                  {active && <Check size={16} aria-hidden className="shrink-0 text-brand-500" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
