import { Check, Layers } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useMapMarkerStyle } from '@/hooks/useMapMarkerStyle';
import { BASEMAPS, type BasemapGroup, type BasemapId } from '@/lib/basemaps';
import type { MapMarkerStyle } from '@/lib/map-marker-style';

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
 * MapSettingsPanel — basemap picker and vehicle/navigation marker chrome.
 * Choices persist and apply on every map in the app. Each basemap is a large
 * clickable preview tile so operators can switch the live map with one tap.
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
  const [markerStyle, setMarkerStyle] = useMapMarkerStyle();

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

  const pickBasemap = (id: BasemapId) => {
    onBasemapChange(id);
  };

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
          className="absolute bottom-full end-0 mb-2 w-[20.5rem] overflow-y-auto rounded-2xl border border-gray-200 bg-white p-2.5 shadow-xl dark:border-white/10 dark:bg-graydark-300"
          style={{ maxHeight: 'min(28rem, 75vh)' }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          <p className="px-1 pt-0.5 pb-2 text-xs font-bold tracking-[0.08em] text-gray-500 uppercase dark:text-graydark-600">
            {t('map.settings.basemap')}
          </p>
          <BasemapGrid
            group="google"
            heading={t('map.settings.providerGoogle', { defaultValue: 'Google' })}
            basemap={basemap}
            onPick={pickBasemap}
            t={t}
          />
          <BasemapGrid
            group="other"
            heading={t('map.settings.providerOther', { defaultValue: 'Other maps' })}
            basemap={basemap}
            onPick={pickBasemap}
            t={t}
          />
          <p className="px-1 pt-3 pb-2 text-xs font-bold tracking-[0.08em] text-gray-500 uppercase dark:text-graydark-600">
            {t('map.settings.markers')}
          </p>
          <div
            role="radiogroup"
            aria-label={t('map.settings.markers')}
            data-testid="map-settings-markers"
            className="flex flex-col gap-1"
          >
            <MarkerStyleOption
              id="vehicle"
              active={markerStyle === 'vehicle'}
              label={t('map.settings.markerVehicle')}
              hint={t('map.settings.markerVehicleHint')}
              onSelect={setMarkerStyle}
            />
            <MarkerStyleOption
              id="navigation"
              active={markerStyle === 'navigation'}
              label={t('map.settings.markerNav')}
              hint={t('map.settings.markerNavHint')}
              onSelect={setMarkerStyle}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function BasemapGrid({
  group,
  heading,
  basemap,
  onPick,
  t,
}: {
  group: BasemapGroup;
  heading: string;
  basemap: BasemapId;
  onPick: (id: BasemapId) => void;
  t: (key: string) => string;
}) {
  const items = BASEMAPS.filter((bm) => bm.group === group);
  return (
    <div className="mb-2">
      <p className="px-1 pb-1.5 text-[10px] font-semibold tracking-[0.06em] text-gray-400 uppercase dark:text-graydark-500">
        {heading}
      </p>
      <div
        role="radiogroup"
        aria-label={heading}
        data-testid={`map-settings-basemaps-${group}`}
        className="grid grid-cols-2 gap-2"
      >
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
              onClick={() => onPick(bm.id)}
              className={`group relative flex cursor-pointer flex-col overflow-hidden rounded-xl border-2 text-start transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 ${
                active
                  ? 'border-brand-500 shadow-md ring-1 ring-brand-500/30'
                  : 'border-gray-200 hover:border-brand-300 hover:shadow-sm dark:border-white/10 dark:hover:border-brand-400/40'
              }`}
            >
              <span
                aria-hidden
                className={`relative block h-16 w-full bg-gradient-to-br ${bm.swatchClass}`}
              >
                {/* Fake map grid so the tile reads as a map preview */}
                <span className="absolute inset-0 opacity-25 [background-image:linear-gradient(rgba(255,255,255,0.35)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.35)_1px,transparent_1px)] [background-size:12px_12px]" />
                {active && (
                  <span className="absolute end-1.5 top-1.5 inline-flex size-5 items-center justify-center rounded-full bg-brand-500 text-white shadow">
                    <Check size={12} aria-hidden strokeWidth={3} />
                  </span>
                )}
              </span>
              <span
                className={`block truncate px-2 py-1.5 text-xs font-semibold ${
                  active
                    ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300'
                    : 'bg-white text-gray-700 group-hover:bg-gray-50 dark:bg-transparent dark:text-graydark-700'
                }`}
              >
                {t(bm.labelKey)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function MarkerStyleOption({
  id,
  active,
  label,
  hint,
  onSelect,
}: {
  id: MapMarkerStyle;
  active: boolean;
  label: string;
  hint: string;
  onSelect: (style: MapMarkerStyle) => void;
}) {
  return (
    <button
      type="button"
      // biome-ignore lint/a11y/useSemanticElements: popover-styled radio group
      role="radio"
      aria-checked={active}
      data-testid={`marker-style-${id}`}
      onClick={() => onSelect(id)}
      className={`flex w-full cursor-pointer items-center gap-2.5 rounded-xl p-1.5 text-start text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 ${
        active
          ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300'
          : 'text-gray-700 hover:bg-gray-100 dark:text-graydark-700 dark:hover:bg-white/5'
      }`}
    >
      <span
        aria-hidden
        className="inline-flex h-7 w-9 shrink-0 items-center justify-center rounded-lg bg-gray-100 text-gray-600 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.08)] dark:bg-white/10 dark:text-graydark-700"
      >
        {id === 'navigation' ? (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
            <path d="M8 2.6 L12.2 12.6 L8 10.4 L3.8 12.6 Z" fill="currentColor" />
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <path d="M5.2 2.2h5.6c.6 0 1 .5 1 1.1v9.4c0 .6-.4 1.1-1 1.1H5.2c-.6 0-1-.5-1-1.1V3.3c0-.6.4-1.1 1-1.1Z" />
            <path d="M6.2 3.6h3.6v2.4H6.2Z" fill="#fff" opacity="0.55" />
          </svg>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{label}</span>
        <span className="block truncate text-[11px] font-normal text-gray-400 dark:text-graydark-500">
          {hint}
        </span>
      </span>
      {active && <Check size={16} aria-hidden className="shrink-0 text-brand-500" />}
    </button>
  );
}
