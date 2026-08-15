/**
 * GeofencePage — geofence management (`/geofences`).
 *
 * Lists all geofences from map-engine-service with create/delete actions.
 * Supports POLYGON (boundary) and CIRCLE (center+radius) types. This is the
 * first feature connected to a real map-engine-service backend endpoint.
 */
import { Circle, MapPin, Plus, ShieldAlert, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useCreateGeofence, useDeleteGeofence, useGeofences } from '@/api/geofence.api';
import { ErrorState } from '@/components/common/ErrorState';
import { GeofenceDrawMap } from '@/components/geofences/GeofenceDrawMap';
import { PageHeader } from '@/components/ui';
import type { AlertOn, GeofenceType } from '@/types/geofence.types';
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';

const ALERT_OPTIONS: AlertOn[] = ['ENTER', 'EXIT', 'DWELL'];

export function GeofencePage() {
  const { t } = useTranslation();
  const { data: geofences, isLoading, isError, error, refetch } = useGeofences();
  const [showCreate, setShowCreate] = useState(false);

  if (isLoading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (isError) {
    return <ErrorState error={error} onRetry={() => refetch()} />;
  }

  return (
    <Stack gap={2}>
      {/* Header */}
      <PageHeader
        title={t('geofences.title')}
        subtitle={t('geofences.subtitle')}
        actions={
          <Button
            variant="contained"
            startIcon={<Plus size={16} />}
            onClick={() => setShowCreate(true)}
          >
            {t('geofences.create')}
          </Button>
        }
      />

      {/* Geofence grid */}
      {(geofences ?? []).length === 0 ? (
        <Stack alignItems="center" gap={2} sx={{ py: 8 }}>
          <MapPin size={48} color="#64748B" />
          <Typography color="text.secondary">{t('geofences.empty')}</Typography>
        </Stack>
      ) : (
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)' },
            gap: 1.5,
          }}
        >
          {(geofences ?? []).map((g) => (
            <GeofenceCard key={g.id} geofence={g} />
          ))}
        </Box>
      )}

      {/* Create dialog (map drawing — Sprint G) */}
      <CreateGeofenceDialog
        open={showCreate}
        onClose={() => setShowCreate(false)}
        geofences={geofences ?? []}
      />
    </Stack>
  );
}

/** A geofence card with type icon, alert rules, and delete. */
function GeofenceCard({ geofence }: { geofence: import('@/types/geofence.types').Geofence }) {
  const { t } = useTranslation();
  const del = useDeleteGeofence();
  const Icon = geofence.type === 'CIRCLE' ? Circle : ShieldAlert;

  return (
    <Card variant="outlined">
      <CardContent>
        <Stack direction="row" alignItems="flex-start" gap={1}>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 36,
              height: 36,
              borderRadius: 2,
              bgcolor: 'primary.main',
              color: '#fff',
              flexShrink: 0,
            }}
          >
            <Icon size={18} />
          </Box>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 600 }} noWrap>
              {geofence.name || t('geofences.untitled')}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {geofence.type}
              {geofence.radiusM ? ` · ${geofence.radiusM}m` : ''}
            </Typography>
          </Box>
          <Button
            size="small"
            color="error"
            startIcon={<Trash2 size={14} />}
            disabled={del.isPending}
            onClick={() => del.mutate(geofence.id)}
          >
            {t('common.delete', { defaultValue: 'Delete' })}
          </Button>
        </Stack>
        {geofence.alertOn.length > 0 && (
          <Stack direction="row" gap={0.5} sx={{ mt: 1, flexWrap: 'wrap' }}>
            {geofence.alertOn.map((a) => (
              <Chip
                key={a}
                size="small"
                label={a}
                variant="outlined"
                sx={{ height: 18, fontSize: '0.6rem' }}
              />
            ))}
          </Stack>
        )}
      </CardContent>
    </Card>
  );
}

/** Create geofence dialog — map drawing (polygon/circle) + form (Sprint G). */
function CreateGeofenceDialog({
  open,
  onClose,
  geofences,
}: {
  open: boolean;
  onClose: () => void;
  geofences: readonly import('@/types/geofence.types').Geofence[];
}) {
  const { t } = useTranslation();
  const create = useCreateGeofence();
  const [name, setName] = useState('');
  const [type, setType] = useState<GeofenceType>('CIRCLE');
  const [radius, setRadius] = useState('500');
  const [alerts, setAlerts] = useState<AlertOn[]>(['ENTER']);
  const [drawn, setDrawn] = useState<
    import('@/components/geofences/GeofenceDrawMap').DrawnGeofence | null
  >(null);

  const submit = () => {
    if (!drawn) return;
    create.mutate(
      {
        name,
        type,
        // The PostGIS polygon boundary IS the operative geometry (ST_Covers
        // drives geofence alarms) — always send it, incl. circle approximations.
        boundary: drawn.boundary,
        centerLat: type === 'CIRCLE' ? drawn.centerLat : undefined,
        centerLng: type === 'CIRCLE' ? drawn.centerLng : undefined,
        radiusM: type === 'CIRCLE' ? drawn.radiusM : undefined,
        alertOn: alerts,
      },
      {
        onSuccess: () => {
          setDrawn(null);
          onClose();
        },
      },
    );
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{t('geofences.createTitle', { defaultValue: 'Create Geofence' })}</DialogTitle>
      <DialogContent>
        <Stack gap={2} sx={{ mt: 1 }}>
          <Stack direction="row" gap={1}>
            <TextField
              label={t('geofences.name', { defaultValue: 'Name' })}
              value={name}
              onChange={(e) => setName(e.target.value)}
              size="small"
              fullWidth
            />
            <Select
              value={type}
              onChange={(e) => setType(e.target.value as GeofenceType)}
              size="small"
              sx={{ minWidth: 140 }}
            >
              <MenuItem value="CIRCLE">CIRCLE</MenuItem>
              <MenuItem value="POLYGON">POLYGON</MenuItem>
            </Select>
            {type === 'CIRCLE' && (
              <TextField
                label={t('geofences.radius', { defaultValue: 'Radius (m)' })}
                value={radius}
                onChange={(e) => setRadius(e.target.value)}
                size="small"
                type="number"
                sx={{ minWidth: 140 }}
              />
            )}
          </Stack>
          <GeofenceDrawMap
            geofences={geofences}
            mode={type === 'CIRCLE' ? 'circle' : 'polygon'}
            circleRadiusM={Number(radius) || 0}
            onDrawn={setDrawn}
          />
          <Select
            multiple
            value={alerts}
            onChange={(e) => setAlerts(e.target.value as unknown as AlertOn[])}
            size="small"
            fullWidth
            renderValue={(v) => (v as AlertOn[]).join(', ')}
          >
            {ALERT_OPTIONS.map((a) => (
              <MenuItem key={a} value={a}>
                {a}
              </MenuItem>
            ))}
          </Select>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.close')}</Button>
        <Button variant="contained" disabled={create.isPending || !name || !drawn} onClick={submit}>
          {create.isPending ? t('common.submitting') : t('geofences.create')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
