import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { type RouteResult, fetchGeocode, fetchRoute } from '@/api/map.api';

interface RoutePlannerDialogProps {
  open: boolean;
  onClose: () => void;
  /** Called with the computed route's geometry for map rendering. */
  onRoute: (geometry: ReadonlyArray<{ lat: number; lng: number }>) => void;
}

/** Parse "lat,lng" input; null when malformed (validated, never guessed). */
function parseLatLng(input: string): { lat: number; lng: number } | null {
  const [lat, lng] = input.split(',').map((s) => Number(s.trim()));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

/**
 * RoutePlannerDialog — minimal real-routing UI (Sprint F §12).
 *
 * Origin/destination as lat,lng coordinates (or a free-text query geocoded via
 * the map-engine). Calls GET /route (OSRM-backed provider); renders distance +
 * duration and hands the geometry to the map. Provider failures (503 when no
 * OSRM_URL is configured) surface as an honest error — never a straight-line
 * fake.
 */
export function RoutePlannerDialog({ open, onClose, onRoute }: RoutePlannerDialogProps) {
  const { t } = useTranslation();
  const [originText, setOriginText] = useState('');
  const [destText, setDestText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RouteResult | null>(null);

  /** Resolve one input field: coordinates directly, otherwise geocode. */
  async function resolvePoint(text: string): Promise<{ lat: number; lng: number } | null> {
    const direct = parseLatLng(text);
    if (direct) return direct;
    const matches = await fetchGeocode(text.trim());
    return matches[0] ? { lat: matches[0].latitude, lng: matches[0].longitude } : null;
  }

  async function compute() {
    setError(null);
    setResult(null);
    if (!originText.trim() || !destText.trim()) {
      setError(t('map.route.needBoth'));
      return;
    }
    setBusy(true);
    try {
      const [origin, dest] = await Promise.all([resolvePoint(originText), resolvePoint(destText)]);
      if (!origin || !dest) {
        setError(t('map.route.unresolved'));
        return;
      }
      const route = await fetchRoute([origin, dest]);
      setResult(route);
      onRoute(route.geometry);
    } catch (err) {
      // Controlled provider failure (503) or bad input — honest error, no fake route.
      setError(err instanceof Error ? err.message : t('errors.genericDesc'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t('map.route.planner')}</DialogTitle>
      <DialogContent>
        <Stack gap={2} sx={{ pt: 1 }}>
          <TextField
            label={t('map.route.origin')}
            placeholder="35.7, 51.4"
            value={originText}
            onChange={(e) => setOriginText(e.target.value)}
            size="small"
            fullWidth
          />
          <TextField
            label={t('map.route.destination')}
            placeholder="35.75, 51.45"
            value={destText}
            onChange={(e) => setDestText(e.target.value)}
            size="small"
            fullWidth
          />
          <Typography variant="caption" color="text.secondary">
            {t('map.route.hint')}
          </Typography>
          {error && <Alert severity="error">{error}</Alert>}
          {result && (
            <Alert severity="success">
              {t('map.route.summary', {
                km: result.distanceKm.toFixed(1),
                min: Math.round(result.durationSec / 60),
                provider: result.provider,
              })}
            </Alert>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.close')}</Button>
        <Button variant="contained" onClick={compute} disabled={busy}>
          {busy ? t('common.loading') : t('map.route.compute')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
