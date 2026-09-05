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
import { formatVehicleLabel } from '@/lib/vehicle-label';
import type { AlertOn, Geofence, GeofenceType } from '@/types/geofence.types';

import { Button, Input, ListboxSelect, Modal, MultiSelect } from '@/components/tailwind-ui';

const ALERT_OPTIONS: AlertOn[] = ['ENTER', 'EXIT', 'DWELL'];

interface VehicleOption {
  readonly id: string;
  readonly label: string;
}

export function GeofenceFormDialog({
  open,
  onClose,
  onSaved,
  /** Present → EDIT mode; absent → CREATE mode. */
  geofence,
}: {
  open: boolean;
  onClose: () => void;
  /** Called after a successful create/update so the overview map can highlight it. */
  onSaved?: (g: Geofence) => void;
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
        setVehicleOptions(vehicles.map((v) => ({ id: v.id, label: formatVehicleLabel(v) })));
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
          onSuccess: (updated) => {
            onSaved?.(updated);
            assign.mutate({ id: geofence.id, vehicleIds }, { onSuccess: onDone, onError });
          },
          onError,
        },
      );
    } else {
      create.mutate(payloadBase, {
        onSuccess: (created) => {
          onSaved?.(created);
          assign.mutate({ id: created.id, vehicleIds }, { onSuccess: onDone, onError });
        },
        onError,
      });
    }
  };

  const pending = create.isPending || update.isPending || assign.isPending;

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title={
        editing
          ? t('geofences.editTitle', { defaultValue: 'Edit Geofence' })
          : t('geofences.createTitle', { defaultValue: 'Create Geofence' })
      }
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.close')}
          </Button>
          <Button
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
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row">
          <Input
            label={t('geofences.name', { defaultValue: 'Name' })}
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label={t('geofences.name', { defaultValue: 'Name' })}
            wrapperClassName="flex-1"
          />
          <ListboxSelect
            label={t('geofences.type', { defaultValue: 'Type' })}
            value={type}
            onChange={(v) => setType(v as GeofenceType)}
            disabled={editing}
            wrapperClassName="sm:w-44"
            options={[
              { value: 'CIRCLE', label: t('geofences.circle', { defaultValue: 'Circle' }) },
              { value: 'POLYGON', label: t('geofences.polygon', { defaultValue: 'Polygon' }) },
            ]}
          />
          {type === 'CIRCLE' && (
            <Input
              label={t('geofences.radius', { defaultValue: 'Radius (m)' })}
              value={radius}
              onChange={(e) => setRadius(e.target.value)}
              type="number"
              min={10}
              aria-label={t('geofences.radius', { defaultValue: 'Radius (m)' })}
              wrapperClassName="sm:w-40"
            />
          )}
        </div>
        <Input
          label={t('geofences.description', { defaultValue: 'Description' })}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <GeofenceDrawMap
          geofences={existing ?? []}
          mode={type === 'CIRCLE' ? 'circle' : 'polygon'}
          circleRadiusM={Number(radius) || 0}
          onDrawn={setDrawn}
          onRadiusChange={(m) => setRadius(String(m))}
          initial={initial}
          excludeId={geofence?.id}
          height={480}
          key={geofence?.id ?? 'new'}
        />
        <div className="flex flex-col gap-3 sm:flex-row">
          <MultiSelect
            label={t('geofences.alerts', { defaultValue: 'Alerts' })}
            values={alerts}
            onChange={(v) => setAlerts(v as AlertOn[])}
            wrapperClassName="flex-1"
            options={ALERT_OPTIONS.map((a) => ({
              value: a,
              label: t(`geofences.alertKinds.${a}`, { defaultValue: a }),
            }))}
          />
          {alerts.includes('DWELL') && (
            <Input
              label={t('geofences.dwellSec', { defaultValue: 'Dwell threshold (s)' })}
              value={dwellSec}
              onChange={(e) => setDwellSec(e.target.value)}
              type="number"
              wrapperClassName="sm:w-48"
            />
          )}
        </div>
        <MultiSelect
          label={t('geofences.assignVehicles', { defaultValue: 'Assigned vehicles' })}
          values={vehicleIds}
          onChange={setVehicleIds}
          placeholder={t('geofences.allVehicles', { defaultValue: 'All vehicles (tenant-wide)' })}
          emptyMessage={t('geofences.noVehicles', { defaultValue: 'No vehicles in the registry' })}
          options={vehicleOptions.map((v) => ({ value: v.id, label: v.label }))}
        />
      </div>
    </Modal>
  );
}
