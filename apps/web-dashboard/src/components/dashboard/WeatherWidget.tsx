import { Box, Skeleton, Stack, Typography } from '@mui/material';
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
 * Added per the FE-3 plan (independent weather widget with mock data). Shows
 * current temperature, condition icon, feels-like, humidity, and wind, plus a
 * compact 3-day forecast row.
 */
export function WeatherWidget() {
  const { t } = useTranslation();
  const { data, isLoading } = useWeather();

  return (
    <WidgetCard titleKey="dashboard.widgets.weather" icon={CloudSun} loading={isLoading}>
      {isLoading || !data ? (
        <Skeleton variant="rounded" sx={{ width: '100%', height: 160 }} />
      ) : (
        <Stack gap={2}>
          {/* Current conditions */}
          <Stack direction="row" alignItems="center" gap={2}>
            <Box
              sx={{
                width: 56,
                height: 56,
                borderRadius: 3,
                background: `linear-gradient(135deg, ${CONDITION_META[data.condition].color}33 0%, ${CONDITION_META[data.condition].color}12 100%)`,
                border: `1px solid ${CONDITION_META[data.condition].color}40`,
                color: CONDITION_META[data.condition].color,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                boxShadow: `inset 0 1px 0 ${CONDITION_META[data.condition].color}30`,
              }}
            >
              {(() => {
                const Icon = CONDITION_META[data.condition].icon;
                return <Icon size={28} />;
              })()}
            </Box>
            <Stack gap={0.25}>
              <Typography
                variant="h3"
                fontWeight={700}
                sx={{ fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}
              >
                {data.temperature}°
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {t(`dashboard.weather.${data.condition}`)} · {data.location}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {t('dashboard.weather.feelsLike', { value: data.feelsLike })}°
              </Typography>
            </Stack>
          </Stack>

          {/* Humidity + wind */}
          <Stack direction="row" gap={3}>
            <Stack direction="row" alignItems="center" gap={0.75}>
              <Droplets size={15} color="var(--mui-palette-text-secondary)" />
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ fontVariantNumeric: 'tabular-nums' }}
              >
                {t('dashboard.weather.humidity', { value: data.humidity })}
              </Typography>
            </Stack>
            <Stack direction="row" alignItems="center" gap={0.75}>
              <Wind size={15} color="var(--mui-palette-text-secondary)" />
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ fontVariantNumeric: 'tabular-nums' }}
              >
                {t('dashboard.weather.wind', { value: data.windSpeed })}
              </Typography>
            </Stack>
          </Stack>

          {/* 3-day forecast */}
          <Stack
            direction="row"
            gap={1}
            sx={{ pt: 1, borderTop: '1px solid', borderColor: 'divider' }}
          >
            {data.forecast.map((f) => {
              const meta = CONDITION_META[f.condition];
              const FIcon = meta.icon;
              return (
                <Box
                  key={f.day}
                  sx={{
                    flex: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 0.5,
                    py: 0.75,
                    borderRadius: 2,
                    border: '1px solid',
                    borderColor: 'divider',
                    backgroundColor: 'rgba(255,255,255,0.40)',
                    backdropFilter: 'blur(6px)',
                  }}
                >
                  <Typography variant="caption" color="text.secondary" fontWeight={600}>
                    {f.day}
                  </Typography>
                  <FIcon size={18} color={meta.color} />
                  <Typography
                    variant="caption"
                    fontWeight={600}
                    sx={{ fontVariantNumeric: 'tabular-nums' }}
                  >
                    {f.high}°
                    <Typography
                      component="span"
                      variant="caption"
                      color="text.secondary"
                      sx={{ fontVariantNumeric: 'tabular-nums', ml: 0.5 }}
                    >
                      {f.low}°
                    </Typography>
                  </Typography>
                </Box>
              );
            })}
          </Stack>
        </Stack>
      )}
    </WidgetCard>
  );
}
