/**
 * GeofenceFormDialog — create AND edit a geofence (Sprint I §12/§15/§16/§48).
 *
 * The map is the PRIMARY drawing interface (GeofenceDrawMap: drag-radius
 * circles, click/drag-vertex polygons). Editing an existing geofence seeds the
 * drawing with its saved geometry — no delete+recreate. Vehicle assignment is
 * a multi-select over the fleet registry (empty selection = tenant-wide,
 * legacy semantics — labeled explicitly).
 *
 * Validation happens here (name required, ≥3 vertices, ≥10 m radius) AND on
 * the backend (PostGIS ST_IsValid is authoritative).
 */
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { fetchAllVehiclesAsMap } from '@/api/asset.api';
import { getApiErrorMessage } from '@/api/errors';
import {
  useAssignGeofenceVehicles,
  useCreateGeofence,
  useGeofences,
  useUpdateGeofence,
} from '@/api/geofence.api';
import { useToast } from '@/components/feedback/ToastProvider';
import { type DrawnGeofence, GeofenceDrawMap } from '@/components/geofences/GeofenceDrawMap';
import type { AlertOn, Geofence, GeofenceType } from '@/types/geofence.types';
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';

const ALERT_OPTIONS: AlertOn[] = ['ENTER', 'EXIT', 'DWELL'];

interface VehicleOption {
  readonly id: string;
  readonly label: string;
}

export function GeofenceFormDialog({
  open,
  onClose,
  /** Present → EDIT mode; absent → CREATE mode. */
  geofence,
}: {
  open: boolean;
  onClose: () => void;
  geofence?: Geofence | null;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const create = useCreateGeofence();
  const update = useUpdateGeofence();
  const assign = useAssignGeofenceVehicles();
  const { data: existing } = useGeofences();

  const editing = Boolean(geofence);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState<GeofenceType>('CIRCLE');
  const [radius, setRadius] = useState('500');
  const [alerts, setAlerts] = useState<AlertOn[]>(['ENTER']);
  const [dwellSec, setDwellSec] = useState('600');
  const [drawn, setDrawn] = useState<DrawnGeofence | null>(null);
  const [vehicleIds, setVehicleIds] = useState<string[]>([]);
  const [vehicleOptions, setVehicleOptions] = useState<VehicleOption[]>([]);

  // Seed the form from the geofence being edited.
  useEffect(() => {
    if (!open) return;
    setName(geofence?.name ?? '');
    setDescription(geofence?.description ?? '');
    setType(geofence?.type === 'POLYGON' ? 'POLYGON' : 'CIRCLE');
    setRadius(String(Math.round(geofence?.radiusM ?? 500)));
    setAlerts(geofence?.alertOn?.length ? [...geofence.alertOn] : ['ENTER']);
    setDwellSec(String(geofence?.dwellSec ?? 600));
    setDrawn(null);
    setVehicleIds(geofence?.assignedVehicleIds ? [...geofence.assignedVehicleIds] : []);
  }, [open, geofence]);

  // Vehicle options for the assignment picker (fleet registry).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void fetchAllVehiclesAsMap()
      .then(({ vehicles }) => {
        if (cancelled) return;
        setVehicleOptions(vehicles.map((v) => ({ id: v.id, label: v.plate ?? v.name ?? v.code })));
      })
      .catch(() => {
        if (!cancelled) setVehicleOptions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const initial = useMemo(() => {
    if (!geofence) return null;
    if (geofence.type === 'CIRCLE' && geofence.centerLat !== null && geofence.centerLng !== null) {
      return {
        type: 'CIRCLE' as const,
        centerLat: geofence.centerLat,
        centerLng: geofence.centerLng,
        radiusM: geofence.radiusM ?? 500,
      };
    }
    const ring = geofence.boundaryGeoJson?.coordinates?.[0];
    if (ring && ring.length >= 3) return { type: 'POLYGON' as const, ring };
    return null;
  }, [geofence]);

  const submit = () => {
    if (!drawn) return;
    const payloadBase = {
      name: name.trim(),
      description: description.trim() || undefined,
      type,
      boundary: drawn.boundary,
      alertOn: alerts,
      ...(type === 'CIRCLE'
        ? { centerLat: drawn.centerLat, centerLng: drawn.centerLng, radiusM: drawn.radiusM }
        : {}),
      ...(alerts.includes('DWELL') ? { dwellSec: Number(dwellSec) || 600 } : {}),
    };
    const onDone = () => {
      toast.success(
        editing
          ? t('geofences.updated', { defaultValue: 'Geofence updated' })
          : t('geofences.created', { defaultValue: 'Geofence created' }),
      );
      onClose();
    };
    const onError = (err: unknown) => {
      toast.error(getApiErrorMessage(err) ?? t('errors.generic'));
    };
    if (editing && geofence) {
      update.mutate(
        { id: geofence.id, payload: payloadBase },
        {
          onSuccess: () => {
            // Assignment set is replaced in a second call (separate endpoint).
            assign.mutate({ id: geofence.id, vehicleIds }, { onSuccess: onDone, onError });
          },
          onError,
        },
      );
    } else {
      create.mutate(payloadBase, {
        onSuccess: (created) => {
          assign.mutate({ id: created.id, vehicleIds }, { onSuccess: onDone, onError });
        },
        onError,
      });
    }
  };

  const pending = create.isPending || update.isPending || assign.isPending;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        {editing
          ? t('geofences.editTitle', { defaultValue: 'Edit Geofence' })
          : t('geofences.createTitle', { defaultValue: 'Create Geofence' })}
      </DialogTitle>
      <DialogContent>
        <Stack gap={2} sx={{ mt: 1 }}>
          <Stack direction={{ xs: 'column', sm: 'row' }} gap={1}>
            <TextField
              label={t('geofences.name', { defaultValue: 'Name' })}
              value={name}
              onChange={(e) => setName(e.target.value)}
              size="small"
              fullWidth
              slotProps={{
                htmlInput: { 'aria-label': t('geofences.name', { defaultValue: 'Name' }) },
              }}
            />
            <FormControl size="small" sx={{ minWidth: 140 }}>
              <InputLabel id="geofence-type-label">
                {t('geofences.type', { defaultValue: 'Type' })}
              </InputLabel>
              <Select
                labelId="geofence-type-label"
                value={type}
                onChange={(e) => setType(e.target.value as GeofenceType)}
                label={t('geofences.type', { defaultValue: 'Type' })}
                disabled={editing}
              >
                <MenuItem value="CIRCLE">
                  {t('geofences.circle', { defaultValue: 'Circle' })}
                </MenuItem>
                <MenuItem value="POLYGON">
                  {t('geofences.polygon', { defaultValue: 'Polygon' })}
                </MenuItem>
              </Select>
            </FormControl>
            {type === 'CIRCLE' && (
              <TextField
                label={t('geofences.radius', { defaultValue: 'Radius (m)' })}
                value={radius}
                onChange={(e) => setRadius(e.target.value)}
                size="small"
                type="number"
                sx={{ minWidth: 130 }}
                slotProps={{
                  htmlInput: {
                    'aria-label': t('geofences.radius', { defaultValue: 'Radius (m)' }),
                    min: 10,
                  },
                }}
              />
            )}
          </Stack>
          <TextField
            label={t('geofences.description', { defaultValue: 'Description' })}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            size="small"
            fullWidth
            multiline
            minRows={1}
          />
          <GeofenceDrawMap
            geofences={existing ?? []}
            mode={type === 'CIRCLE' ? 'circle' : 'polygon'}
            circleRadiusM={Number(radius) || 0}
            onDrawn={setDrawn}
            onRadiusChange={(m) => setRadius(String(m))}
            initial={initial}
            key={geofence?.id ?? 'new'}
          />
          <Stack direction={{ xs: 'column', sm: 'row' }} gap={1}>
            <FormControl size="small" fullWidth>
              <InputLabel id="geofence-alerts-label">
                {t('geofences.alerts', { defaultValue: 'Alerts' })}
              </InputLabel>
              <Select
                labelId="geofence-alerts-label"
                multiple
                value={alerts}
                onChange={(e) => setAlerts(e.target.value as unknown as AlertOn[])}
                label={t('geofences.alerts', { defaultValue: 'Alerts' })}
                renderValue={(v) => (
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                    {(v as AlertOn[]).map((a) => (
                      <Chip key={a} size="small" label={a} />
                    ))}
                  </Box>
                )}
              >
                {ALERT_OPTIONS.map((a) => (
                  <MenuItem key={a} value={a}>
                    {t(`geofences.alertKinds.${a}`, { defaultValue: a })}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            {alerts.includes('DWELL') && (
              <TextField
                label={t('geofences.dwellSec', { defaultValue: 'Dwell threshold (s)' })}
                value={dwellSec}
                onChange={(e) => setDwellSec(e.target.value)}
                size="small"
                type="number"
                sx={{ minWidth: 180 }}
              />
            )}
          </Stack>
          <FormControl size="small" fullWidth>
            <InputLabel id="geofence-vehicles-label">
              {t('geofences.assignVehicles', { defaultValue: 'Assigned vehicles' })}
            </InputLabel>
            <Select
              labelId="geofence-vehicles-label"
              multiple
              value={vehicleIds}
              onChange={(e) => setVehicleIds(e.target.value as unknown as string[])}
              label={t('geofences.assignVehicles', { defaultValue: 'Assigned vehicles' })}
              renderValue={(v) =>
                (v as string[]).length === 0 ? (
                  <Typography variant="caption">
                    {t('geofences.allVehicles', { defaultValue: 'All vehicles (tenant-wide)' })}
                  </Typography>
                ) : (
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                    {(v as string[]).map((id) => (
                      <Chip
                        key={id}
                        size="small"
                        label={vehicleOptions.find((o) => o.id === id)?.label ?? id.slice(0, 8)}
                      />
                    ))}
                  </Box>
                )
              }
            >
              {vehicleOptions.length === 0 ? (
                <MenuItem disabled>
                  {t('geofences.noVehicles', { defaultValue: 'No vehicles in the registry' })}
                </MenuItem>
              ) : (
                vehicleOptions.map((v) => (
                  <MenuItem key={v.id} value={v.id}>
                    {v.label}
                  </MenuItem>
                ))
              )}
            </Select>
          </FormControl>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.close')}</Button>
        <Button
          variant="contained"
          disabled={pending || !name.trim() || !drawn}
          onClick={submit}
          data-testid="geofence-save"
        >
          {pending
            ? t('common.submitting')
            : editing
              ? t('common.save', { defaultValue: 'Save' })
              : t('geofences.create')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
