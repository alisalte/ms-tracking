import { Check, Layers } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { BASEMAPS, type BasemapGroup, type BasemapId } from '@/lib/basemaps';

interface MapSettingsPanelProps {
  /** Active basemap style id. */
  basemap: BasemapId;
  onBasemapChange: (basemap: BasemapId) => void;
  /** Lift the button above the history playback transport while it runs. */
  raised?: boolean;
  /**
   * `beside-nav` sits inward of MapLibre zoom/compass. `corner` is for maps
   * without those controls (geofence / trip / alarm).
   */
  placement?: 'beside-nav' | 'corner';
}

/**
 * MapSettingsPanel — basemap picker (Google + OSM/Esri/topo). The choice is
 * persisted and applied on every map in the app.
 */
export function MapSettingsPanel({
  basemap,
  onBasemapChange,
  raised = false,
  placement = 'beside-nav',
}: MapSettingsPanelProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

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

  const inset = placement === 'beside-nav' ? 'end-14' : 'end-2';
  const bottom =
    placement === 'beside-nav' ? (raised ? 'bottom-[5.75rem]' : 'bottom-[4.75rem]') : 'bottom-2';

  return (
    <div
      ref={rootRef}
      className={`pointer-events-auto absolute z-30 ${inset} ${bottom} transition-[bottom] duration-200`}
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
          className="absolute bottom-full end-0 mb-2 w-64 overflow-y-auto rounded-2xl border border-gray-200 bg-white p-1.5 shadow-xl dark:border-white/10 dark:bg-graydark-300"
          style={{ maxHeight: 'min(24rem, 70vh)' }}
        >
          <p className="px-2 pt-1 pb-1.5 text-xs font-bold tracking-[0.08em] text-gray-500 uppercase dark:text-graydark-600">
            {t('map.settings.basemap')}
          </p>
          <BasemapRadios
            group="google"
            heading={t('map.settings.providerGoogle', { defaultValue: 'Google' })}
            basemap={basemap}
            onBasemapChange={onBasemapChange}
            t={t}
          />
          <BasemapRadios
            group="other"
            heading={t('map.settings.providerOther', { defaultValue: 'Other maps' })}
            basemap={basemap}
            onBasemapChange={onBasemapChange}
            t={t}
          />
        </div>
      )}
    </div>
  );
}

function BasemapRadios({
  group,
  heading,
  basemap,
  onBasemapChange,
  t,
}: {
  group: BasemapGroup;
  heading: string;
  basemap: BasemapId;
  onBasemapChange: (id: BasemapId) => void;
  t: (key: string) => string;
}) {
  const items = BASEMAPS.filter((bm) => bm.group === group);
  return (
    <div className="mb-1">
      <p className="px-2 pt-1 pb-0.5 text-[10px] font-semibold tracking-[0.06em] text-gray-400 uppercase dark:text-graydark-500">
        {heading}
      </p>
      <div role="radiogroup" aria-label={heading} data-testid={`map-settings-basemaps-${group}`}>
        {items.map((bm) => {
          const active = bm.id === basemap;
          return (
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
  );
}
