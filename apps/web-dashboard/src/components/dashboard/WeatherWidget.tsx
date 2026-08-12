import {
  Cloud,
  CloudLightning,
  CloudRain,
  CloudSnow,
  CloudSun,
  Cloudy,
  Droplets,
  type LucideIcon,
  Sun,
  Wind,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { useWeather } from '@/api/fleet.api';
import type { WeatherCondition } from '@/types/fleet.types';

import { WidgetCard } from './WidgetCard';

/** Condition → lucide icon + tint (§0.7: icon pairs with color, never color alone). */
const CONDITION_META: Record<WeatherCondition, { icon: LucideIcon; color: string }> = {
  clear: { icon: Sun, color: '#F59E0B' },
  'partly-cloudy': { icon: Cloudy, color: '#64748B' },
  cloudy: { icon: Cloud, color: '#64748B' },
  rain: { icon: CloudRain, color: '#2563EB' },
  storm: { icon: CloudLightning, color: '#9333EA' },
  snow: { icon: CloudSnow, color: '#0EA5E9' },
};

/**
 * WeatherWidget — current conditions + 3-day forecast (independent widget).
 *
 * Shows current temperature, condition icon, feels-like, humidity, and wind,
 * plus a compact 3-day forecast row.
 *
 * Tailwind surface; `useWeather()` hook + condition metadata unchanged.
 */
export function WeatherWidget() {
  const { t } = useTranslation();
  const { data, isLoading } = useWeather();

  return (
    <WidgetCard titleKey="dashboard.widgets.weather" icon={CloudSun} loading={isLoading}>
      {isLoading || !data ? (
        <div className="h-40 w-full animate-pulse rounded-lg bg-gray-100 dark:bg-white/5" />
      ) : (
        <div className="flex flex-col gap-4">
          {/* Current conditions */}
          <div className="flex items-center gap-3">
            <div
              className="flex size-[52px] shrink-0 items-center justify-center rounded-full"
              style={{
                backgroundColor: `${CONDITION_META[data.condition].color}1A`,
                color: CONDITION_META[data.condition].color,
              }}
            >
              {(() => {
                const Icon = CONDITION_META[data.condition].icon;
                return <Icon size={28} />;
              })()}
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-3xl font-bold leading-none tabular-nums text-gray-900 dark:text-white">
                {data.temperature}°
              </span>
              <span className="text-xs text-gray-500 dark:text-graydark-600">
                {t(`dashboard.weather.${data.condition}`)} · {data.location}
              </span>
              <span className="text-xs text-gray-500 dark:text-graydark-600">
                {t('dashboard.weather.feelsLike', { value: data.feelsLike })}°
              </span>
            </div>
          </div>

          {/* Humidity + wind */}
          <div className="flex gap-6">
            <div className="flex items-center gap-2">
              <Droplets size={15} className="text-gray-400" />
              <span className="text-sm tabular-nums text-gray-500 dark:text-graydark-600">
                {t('dashboard.weather.humidity', { value: data.humidity })}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Wind size={15} className="text-gray-400" />
              <span className="text-sm tabular-nums text-gray-500 dark:text-graydark-600">
                {t('dashboard.weather.wind', { value: data.windSpeed })}
              </span>
            </div>
          </div>

          {/* 3-day forecast */}
          <div className="flex gap-2 border-t border-gray-100 pt-3 dark:border-white/5">
            {data.forecast.map((f) => {
              const meta = CONDITION_META[f.condition];
              const FIcon = meta.icon;
              return (
                <div
                  key={f.day}
                  className="flex flex-1 flex-col items-center gap-1 rounded-lg bg-gray-50 py-3 dark:bg-white/5"
                >
                  <span className="text-xs font-semibold text-gray-500 dark:text-graydark-600">
                    {f.day}
                  </span>
                  <FIcon size={18} style={{ color: meta.color }} />
                  <span className="text-xs font-semibold tabular-nums text-gray-800 dark:text-white">
                    {f.high}°<span className="ms-1 tabular-nums text-gray-400">{f.low}°</span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </WidgetCard>
  );
}
