/**
 * SettingsSection — tenant settings form (UI_UX §5.2 Settings).
 *
 * Locale, timezone, units (distance/volume/temp), date format, org name
 * (branding), and data-retention preview. Saves via `useUpdateSettings`
 * (optimistic).
 */
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useSettings, useUpdateSettings } from '@/api/admin.api';
import { ErrorState } from '@/components/common/ErrorState';
import type { DistanceUnit, TempUnit, VolumeUnit } from '@/types/admin.types';
import {
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';

const TIMEZONES = ['UTC', 'Asia/Tehran', 'America/New_York', 'Europe/London', 'Asia/Dubai'];
const LOCALES = ['en', 'fa'];

export function SettingsSection() {
  const { t } = useTranslation();
  const { data: settings, isLoading, isError, error, refetch } = useSettings();
  const update = useUpdateSettings();

  // Local form state mirrors the loaded settings; edit + Save commits.
  const draft = useMemo(() => settings, [settings]);

  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  // No settings backend exists yet — fail honestly instead of fabricating (§22).
  if (isError || !draft) {
    return (
      <ErrorState
        error={error ?? new Error('Tenant settings are unavailable')}
        onRetry={() => refetch()}
      />
    );
  }

  return (
    <Stack gap={2} sx={{ p: 2, maxWidth: 640 }}>
      {/* Locale & format */}
      <Card variant="outlined">
        <CardContent>
          <Typography variant="subtitle2" sx={{ mb: 1.5, fontWeight: 600 }}>
            {t('admin.settings.locale')}
          </Typography>
          <Stack gap={2}>
            <Field label={t('admin.settings.language')}>
              <Select
                size="small"
                fullWidth
                value={draft.locale}
                onChange={(e) => update.mutate({ locale: e.target.value })}
              >
                {LOCALES.map((l) => (
                  <MenuItem key={l} value={l}>
                    {t(`admin.settings.lang.${l}`)}
                  </MenuItem>
                ))}
              </Select>
            </Field>
            <Field label={t('admin.settings.timezone')}>
              <Select
                size="small"
                fullWidth
                value={draft.timezone}
                onChange={(e) => update.mutate({ timezone: e.target.value })}
              >
                {TIMEZONES.map((tz) => (
                  <MenuItem key={tz} value={tz}>
                    {tz}
                  </MenuItem>
                ))}
              </Select>
            </Field>
            <Field label={t('admin.settings.dateFormat')}>
              <TextField
                size="small"
                fullWidth
                value={draft.dateFormat}
                onChange={(e) => update.mutate({ dateFormat: e.target.value })}
              />
            </Field>
          </Stack>
        </CardContent>
      </Card>

      {/* Units */}
      <Card variant="outlined">
        <CardContent>
          <Typography variant="subtitle2" sx={{ mb: 1.5, fontWeight: 600 }}>
            {t('admin.settings.units')}
          </Typography>
          <Stack direction="row" gap={2} sx={{ flexWrap: 'wrap' }}>
            <Field label={t('admin.settings.distance')}>
              <Select
                size="small"
                value={draft.distanceUnit}
                onChange={(e) => update.mutate({ distanceUnit: e.target.value as DistanceUnit })}
              >
                <MenuItem value="km">km</MenuItem>
                <MenuItem value="mi">mi</MenuItem>
              </Select>
            </Field>
            <Field label={t('admin.settings.volume')}>
              <Select
                size="small"
                value={draft.volumeUnit}
                onChange={(e) => update.mutate({ volumeUnit: e.target.value as VolumeUnit })}
              >
                <MenuItem value="L">L</MenuItem>
                <MenuItem value="gal">gal</MenuItem>
              </Select>
            </Field>
            <Field label={t('admin.settings.temperature')}>
              <Select
                size="small"
                value={draft.tempUnit}
                onChange={(e) => update.mutate({ tempUnit: e.target.value as TempUnit })}
              >
                <MenuItem value="C">°C</MenuItem>
                <MenuItem value="F">°F</MenuItem>
              </Select>
            </Field>
          </Stack>
        </CardContent>
      </Card>

      {/* Branding + retention */}
      <Card variant="outlined">
        <CardContent>
          <Typography variant="subtitle2" sx={{ mb: 1.5, fontWeight: 600 }}>
            {t('admin.settings.branding')}
          </Typography>
          <Stack gap={2}>
            <Field label={t('admin.settings.orgName')}>
              <TextField
                size="small"
                fullWidth
                value={draft.orgName}
                onChange={(e) => update.mutate({ orgName: e.target.value })}
              />
            </Field>
            <Field label={t('admin.settings.retention')}>
              <TextField
                size="small"
                type="number"
                value={draft.retentionDays}
                onChange={(e) => update.mutate({ retentionDays: Number(e.target.value) || 0 })}
                sx={{ maxWidth: 120 }}
              />
              <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                {t('admin.settings.retentionDays')}
              </Typography>
            </Field>
          </Stack>
        </CardContent>
      </Card>

      <Box>
        <Button variant="contained" disabled={update.isPending}>
          {update.isPending ? t('admin.settings.saving') : t('admin.settings.saved')}
        </Button>
      </Box>
    </Stack>
  );
}

/** A labeled field wrapper. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Box sx={{ flex: 1, minWidth: 160 }}>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Box sx={{ mt: 0.5 }}>{children}</Box>
    </Box>
  );
}
