import { zodResolver } from '@hookform/resolvers/zod';
import {
  Box,
  Button,
  CircularProgress,
  Divider,
  Drawer,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useEffect, useMemo, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import {
  useCreateDevice,
  useCreateDriver,
  useCreateGroup,
  useCreateVehicle,
  useUpdateDevice,
  useUpdateDriver,
  useUpdateGroup,
  useUpdateVehicle,
} from '@/api/asset.api';
import { useToast } from '@/components/feedback/ToastProvider';
import { FormAlert } from '@/components/form/FormAlert';
import { deviceSchema, driverSchema, groupSchema, vehicleSchema } from '@/lib/validation';
import type { AssetTab } from '@/pages/AssetManagementPage';
import type {
  CreateDevicePayload,
  CreateDriverPayload,
  CreateGroupPayload,
  CreateVehiclePayload,
  Device,
  Driver,
  Vehicle,
  VehicleGroup,
} from '@/types/asset.types';

const DRAWER_WIDTH = 480;

/** The discriminated record a drawer can edit (create omits the record). */
export type AssetRecord = Vehicle | Driver | Device | VehicleGroup;

export interface AssetFormDrawerProps {
  open: boolean;
  mode: 'create' | 'edit';
  entity: AssetTab;
  /** For edit mode: the record being edited. Omit for create. */
  record?: AssetRecord;
  onClose: () => void;
  /** Invoked after a successful create/update (the hook already invalidated). */
  onSuccess?: () => void;
}

/**
 * AssetFormDrawer — one reusable right-slide-over drawer for creating OR editing
 * any of the four asset entities (Vehicle / Driver / Device / Group).
 *
 * - Selects the right zod schema + field set per `entity`.
 * - Edit mode prefills from `record`; create mode starts empty.
 * - Submits via the matching create/update hook, then fires a success toast +
 *   calls `onSuccess` + closes. Errors are shown inline via `<FormAlert>` and
 *   toasted.
 *
 * Field sets mirror the editable subset of each domain model (no invented
 * fields — see docs/frontend-crud.md).
 */
export function AssetFormDrawer({
  open,
  mode,
  entity,
  record,
  onClose,
  onSuccess,
}: AssetFormDrawerProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const isEdit = mode === 'edit';

  // Per-entity create/update hooks.
  const createVehicle = useCreateVehicle();
  const updateVehicle = useUpdateVehicle();
  const createDriver = useCreateDriver();
  const updateDriver = useUpdateDriver();
  const createDevice = useCreateDevice();
  const updateDevice = useUpdateDevice();
  const createGroup = useCreateGroup();
  const updateGroup = useUpdateGroup();

  const schema = useMemo(
    () =>
      entity === 'vehicles'
        ? vehicleSchema
        : entity === 'drivers'
          ? driverSchema
          : entity === 'devices'
            ? deviceSchema
            : groupSchema,
    [entity],
  );

  // Build default values from the record (edit) or sane create defaults.
  const defaultValues = useMemo(
    () => buildDefaults(entity, record, isEdit),
    [entity, record, isEdit],
  );

  const {
    control,
    handleSubmit,
    reset,
    formState: { errors },
    // Form values are dynamic across entities (vehicle/driver/device/group),
    // so the values type is intentionally loose; payloads are cast at the call site.
    // biome-ignore lint/suspicious/noExplicitAny: entity form shape varies
  } = useForm<Record<string, any>>({
    resolver: zodResolver(schema) as never,
    defaultValues,
    mode: 'onSubmit',
  });

  // Re-sync the form when the record/entity/mode changes (edit drawer reuse).
  useEffect(() => {
    reset(buildDefaults(entity, record, isEdit));
  }, [entity, record, isEdit, reset]);

  const [serverError, setServerError] = useState<string | null>(null);

  // Resolve the pending mutation + i18n labels for the active entity.
  const isPending =
    entity === 'vehicles'
      ? isEdit
        ? updateVehicle.isPending
        : createVehicle.isPending
      : entity === 'drivers'
        ? isEdit
          ? updateDriver.isPending
          : createDriver.isPending
        : entity === 'devices'
          ? isEdit
            ? updateDevice.isPending
            : createDevice.isPending
          : isEdit
            ? updateGroup.isPending
            : createGroup.isPending;

  const entityLabelKey =
    entity === 'vehicles'
      ? 'assets.tabs.vehicles'
      : entity === 'drivers'
        ? 'assets.tabs.drivers'
        : entity === 'devices'
          ? 'assets.tabs.devices'
          : 'assets.tabs.groups';

  const onSubmit = async (values: Record<string, unknown>) => {
    setServerError(null);
    try {
      if (entity === 'vehicles') {
        if (isEdit && record) {
          await updateVehicle.mutateAsync({
            id: record.id,
            changes: values as unknown as CreateVehiclePayload,
          });
        } else {
          await createVehicle.mutateAsync(values as unknown as CreateVehiclePayload);
        }
      } else if (entity === 'drivers') {
        if (isEdit && record) {
          await updateDriver.mutateAsync({
            id: record.id,
            changes: values as unknown as CreateDriverPayload,
          });
        } else {
          await createDriver.mutateAsync(values as unknown as CreateDriverPayload);
        }
      } else if (entity === 'devices') {
        if (isEdit && record) {
          await updateDevice.mutateAsync({
            id: record.id,
            changes: values as unknown as CreateDevicePayload,
          });
        } else {
          await createDevice.mutateAsync(values as unknown as CreateDevicePayload);
        }
      } else {
        if (isEdit && record) {
          await updateGroup.mutateAsync({
            id: record.id,
            changes: values as unknown as CreateGroupPayload,
          });
        } else {
          await createGroup.mutateAsync(values as unknown as CreateGroupPayload);
        }
      }
      toast.success(
        t(isEdit ? 'assets.crud.updateSuccess' : 'assets.crud.createSuccess', {
          name: t(entityLabelKey),
        }),
      );
      onSuccess?.();
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('errors.generic');
      setServerError(msg);
      toast.error(err);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      anchor="right"
      variant="temporary"
      sx={{ '& .MuiDrawer-paper': { width: DRAWER_WIDTH, maxWidth: '100vw' } }}
    >
      <Stack sx={{ height: '100%' }}>
        {/* Header */}
        <Stack
          direction="row"
          alignItems="center"
          sx={{
            p: 2,
            borderBottom: '1px solid',
            borderColor: 'divider',
            position: 'sticky',
            top: 0,
            bgcolor: 'background.paper',
            zIndex: 1,
          }}
        >
          <Box>
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
              {t(isEdit ? 'common.edit' : 'common.add')} {t(entityLabelKey)}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {t(entityLabelKey)}
            </Typography>
          </Box>
          <Box sx={{ flex: 1 }} />
          <Button size="small" onClick={onClose} aria-label={t('common.close')}>
            ✕
          </Button>
        </Stack>

        {/* Body */}
        <Box
          component="form"
          onSubmit={handleSubmit(onSubmit)}
          noValidate
          sx={{ flex: 1, overflowY: 'auto', p: 2 }}
        >
          <FormAlert severity="error" message={serverError} />

          <Stack gap={2}>
            {entity === 'vehicles' && <VehicleFields control={control} errors={errors} t={t} />}
            {entity === 'drivers' && <DriverFields control={control} errors={errors} t={t} />}
            {entity === 'devices' && <DeviceFields control={control} errors={errors} t={t} />}
            {entity === 'groups' && <GroupFields control={control} errors={errors} t={t} />}
          </Stack>

          <Divider sx={{ my: 2 }} />
          <Typography variant="caption" color="text.secondary">
            {t('validation.asteriskHelp', { defaultValue: '* = required field' })}
          </Typography>

          {/* Sticky footer actions */}
          <Stack direction="row" gap={1} sx={{ mt: 2, mb: 1 }}>
            <Button fullWidth variant="outlined" onClick={onClose} disabled={isPending}>
              {t('common.cancel')}
            </Button>
            <Button
              fullWidth
              type="submit"
              variant="contained"
              disabled={isPending}
              startIcon={isPending ? <CircularProgress size={16} color="inherit" /> : undefined}
            >
              {isPending ? t('common.submitting') : t(isEdit ? 'common.save' : 'common.create')}
            </Button>
          </Stack>
        </Box>
      </Stack>
    </Drawer>
  );
}

// ── Per-entity field sets ────────────────────────────────────────────────────
// Each renders MUI TextField / Select via <Controller>. Required fields carry
// a trailing " *" in the label and zod-enforced validation.

import type { SxProps, Theme } from '@mui/material';
import type { TFunction } from 'i18next';
import type { Control, ControllerRenderProps, FieldError, FieldErrors } from 'react-hook-form';

interface FieldProps {
  // biome-ignore lint/suspicious/noExplicitAny: form values are dynamic across entities
  control: Control<any>;
  // biome-ignore lint/suspicious/noExplicitAny: errors are dynamic across entities
  errors: FieldErrors<any>;
  t: TFunction;
}

const VEHICLE_TYPES: Array<{ value: string; key: string }> = [
  { value: 'truck', key: 'assets.vehicle.type.truck' },
  { value: 'van', key: 'assets.vehicle.type.van' },
  { value: 'bus', key: 'assets.vehicle.type.bus' },
  { value: 'car', key: 'assets.vehicle.type.car' },
];
const VEHICLE_STATUSES = ['active', 'inactive', 'maintenance', 'decommissioned', 'sold'];
const FUEL_TYPES = ['diesel', 'gasoline', 'electric', 'hybrid', 'cng', 'lpg'];
const DRIVER_STATUSES = ['active', 'inactive', 'suspended', 'terminated'];
const DEVICE_TYPES: Array<{ value: string; key: string }> = [
  { value: 'obd2', key: 'assets.device.type.obd2' },
  { value: 'gps_tracker', key: 'assets.device.type.gps_tracker' },
  { value: 'dashcam', key: 'assets.device.type.dashcam' },
  { value: 'custom_sensor', key: 'assets.device.type.custom_sensor' },
];
const DEVICE_STATUSES = [
  'provisioned',
  'active',
  'inactive',
  'firmware_updating',
  'faulted',
  'decommissioned',
];
const GROUP_STATUSES = ['active', 'archived'];

function VehicleFields({ control, errors, t }: FieldProps) {
  return (
    <>
      <FieldText
        control={control}
        name="licensePlate"
        label={`${t('assets.vehicle.colPlate')} *`}
        error={errors.licensePlate as FieldError | undefined}
        t={t}
      />
      <FieldText
        control={control}
        name="vin"
        label={`${t('assets.vehicle.vin')} *`}
        error={errors.vin as FieldError | undefined}
        t={t}
      />
      <Stack direction={{ xs: 'column', sm: 'row' }} gap={2}>
        <FieldText
          control={control}
          name="make"
          label={`${t('assets.vehicle.make')} *`}
          sx={{ flex: 1 }}
          error={errors.make as FieldError | undefined}
          t={t}
        />
        <FieldText
          control={control}
          name="model"
          label={`${t('assets.vehicle.model')} *`}
          sx={{ flex: 1 }}
          error={errors.model as FieldError | undefined}
          t={t}
        />
      </Stack>
      <Stack direction={{ xs: 'column', sm: 'row' }} gap={2}>
        <FieldNumber
          control={control}
          name="year"
          label={`${t('assets.vehicle.year')} *`}
          sx={{ flex: 1 }}
          error={errors.year as FieldError | undefined}
          t={t}
        />
        <FieldText
          control={control}
          name="color"
          label={t('assets.vehicle.color', { defaultValue: 'Color' })}
          sx={{ flex: 1 }}
          t={t}
        />
      </Stack>
      <Stack direction={{ xs: 'column', sm: 'row' }} gap={2}>
        <FieldSelect
          control={control}
          name="type"
          label={`${t('assets.vehicle.colType')} *`}
          options={VEHICLE_TYPES.map((o) => ({ value: o.value, label: t(o.key) }))}
          sx={{ flex: 1 }}
          t={t}
        />
        <FieldSelect
          control={control}
          name="fuelType"
          label={t('assets.vehicle.fuelType', { defaultValue: 'Fuel' })}
          options={FUEL_TYPES.map((o) => ({ value: o, label: t(`assets.vehicle.fuel.${o}`) }))}
          sx={{ flex: 1 }}
          t={t}
        />
      </Stack>
      <FieldSelect
        control={control}
        name="status"
        label={t('assets.vehicle.colStatus')}
        options={VEHICLE_STATUSES.map((o) => ({
          value: o,
          label: t(`assets.vehicle.status.${o}`),
        }))}
        t={t}
      />
      <FieldText
        control={control}
        name="groupId"
        label={t('assets.vehicle.fleet', { defaultValue: 'Group ID' })}
        optional
        t={t}
      />
      <FieldText
        control={control}
        name="deviceId"
        label={t('assets.vehicle.device', { defaultValue: 'Device ID' })}
        optional
        t={t}
      />
    </>
  );
}

function DriverFields({ control, errors, t }: FieldProps) {
  return (
    <>
      <Stack direction={{ xs: 'column', sm: 'row' }} gap={2}>
        <FieldText
          control={control}
          name="firstName"
          label={`${t('assets.driver.firstName', { defaultValue: 'First name' })} *`}
          sx={{ flex: 1 }}
          error={errors.firstName as FieldError | undefined}
          t={t}
        />
        <FieldText
          control={control}
          name="lastName"
          label={`${t('assets.driver.lastName', { defaultValue: 'Last name' })} *`}
          sx={{ flex: 1 }}
          error={errors.lastName as FieldError | undefined}
          t={t}
        />
      </Stack>
      <FieldText
        control={control}
        name="email"
        label={t('auth.email')}
        error={errors.email as FieldError | undefined}
        t={t}
      />
      <FieldText
        control={control}
        name="phone"
        label={`${t('assets.driver.phone', { defaultValue: 'Phone' })} *`}
        error={errors.phone as FieldError | undefined}
        t={t}
      />
      <FieldText
        control={control}
        name="employeeId"
        label={t('assets.driver.employeeId', { defaultValue: 'Employee ID' })}
        optional
        t={t}
      />
      <Stack direction={{ xs: 'column', sm: 'row' }} gap={2}>
        <FieldText
          control={control}
          name="licenseNumber"
          label={`${t('assets.driver.license', { defaultValue: 'License number' })} *`}
          sx={{ flex: 1 }}
          error={errors.licenseNumber as FieldError | undefined}
          t={t}
        />
        <FieldText
          control={control}
          name="licenseClass"
          label={`${t('assets.driver.licenseClass', { defaultValue: 'License class' })} *`}
          sx={{ flex: 1 }}
          error={errors.licenseClass as FieldError | undefined}
          t={t}
        />
      </Stack>
      <Stack direction={{ xs: 'column', sm: 'row' }} gap={2}>
        <FieldText
          control={control}
          name="licenseExpiry"
          label={`${t('assets.driver.licenseExpiry', { defaultValue: 'License expiry' })} *`}
          sx={{ flex: 1 }}
          type="date"
          error={errors.licenseExpiry as FieldError | undefined}
          t={t}
        />
        <FieldSelect
          control={control}
          name="status"
          label={t('assets.driver.colStatus', { defaultValue: 'Status' })}
          options={DRIVER_STATUSES.map((o) => ({
            value: o,
            label: t(`assets.driver.status.${o}`),
          }))}
          sx={{ flex: 1 }}
          t={t}
        />
      </Stack>
      <FieldText
        control={control}
        name="assignedVehicleId"
        label={t('assets.driver.assigned', { defaultValue: 'Assigned vehicle' })}
        optional
        t={t}
      />
    </>
  );
}

function DeviceFields({ control, errors, t }: FieldProps) {
  return (
    <>
      <FieldText
        control={control}
        name="serialNumber"
        label={`${t('assets.device.colSerial', { defaultValue: 'Serial number' })} *`}
        error={errors.serialNumber as FieldError | undefined}
        t={t}
      />
      <Stack direction={{ xs: 'column', sm: 'row' }} gap={2}>
        <FieldSelect
          control={control}
          name="deviceType"
          label={`${t('assets.device.colType', { defaultValue: 'Type' })} *`}
          options={DEVICE_TYPES.map((o) => ({ value: o.value, label: t(o.key) }))}
          sx={{ flex: 1 }}
          t={t}
        />
        <FieldText
          control={control}
          name="imei"
          label={t('assets.device.imei', { defaultValue: 'IMEI' })}
          sx={{ flex: 1 }}
          optional
          error={errors.imei as FieldError | undefined}
          t={t}
        />
      </Stack>
      <Stack direction={{ xs: 'column', sm: 'row' }} gap={2}>
        <FieldText
          control={control}
          name="manufacturer"
          label={`${t('assets.device.manufacturer', { defaultValue: 'Manufacturer' })} *`}
          sx={{ flex: 1 }}
          error={errors.manufacturer as FieldError | undefined}
          t={t}
        />
        <FieldText
          control={control}
          name="model"
          label={`${t('assets.device.model', { defaultValue: 'Model' })} *`}
          sx={{ flex: 1 }}
          error={errors.model as FieldError | undefined}
          t={t}
        />
      </Stack>
      <Stack direction={{ xs: 'column', sm: 'row' }} gap={2}>
        <FieldText
          control={control}
          name="firmwareVersion"
          label={`${t('assets.device.firmware', { defaultValue: 'Firmware' })} *`}
          sx={{ flex: 1 }}
          error={errors.firmwareVersion as FieldError | undefined}
          t={t}
        />
        <FieldNumber
          control={control}
          name="reportingIntervalSec"
          label={`${t('assets.device.reportingInterval', { defaultValue: 'Interval (s)' })} *`}
          sx={{ flex: 1 }}
          error={errors.reportingIntervalSec as FieldError | undefined}
          t={t}
        />
      </Stack>
      <Stack direction={{ xs: 'column', sm: 'row' }} gap={2}>
        <FieldSelect
          control={control}
          name="status"
          label={t('assets.device.colStatus', { defaultValue: 'Status' })}
          options={DEVICE_STATUSES.map((o) => ({
            value: o,
            label: t(`assets.device.status.${o}`),
          }))}
          sx={{ flex: 1 }}
          t={t}
        />
        <FieldText
          control={control}
          name="boundVehicleId"
          label={t('assets.device.colVehicle', { defaultValue: 'Vehicle' })}
          sx={{ flex: 1 }}
          optional
          t={t}
        />
      </Stack>
    </>
  );
}

function GroupFields({ control, errors, t }: FieldProps) {
  return (
    <>
      <FieldText
        control={control}
        name="name"
        label={`${t('assets.group.name', { defaultValue: 'Name' })} *`}
        error={errors.name as FieldError | undefined}
        t={t}
      />
      <FieldText
        control={control}
        name="description"
        label={t('assets.group.description', { defaultValue: 'Description' })}
        multiline
        rows={2}
        t={t}
      />
      <Stack direction={{ xs: 'column', sm: 'row' }} gap={2}>
        <FieldSelect
          control={control}
          name="vehicleTypeFilter"
          label={t('assets.vehicle.colType', { defaultValue: 'Vehicle type' })}
          options={[
            { value: '', label: t('common.all') },
            ...VEHICLE_TYPES.map((o) => ({ value: o.value, label: t(o.key) })),
          ]}
          sx={{ flex: 1 }}
          t={t}
        />
        <FieldSelect
          control={control}
          name="status"
          label={t('assets.vehicle.colStatus', { defaultValue: 'Status' })}
          options={GROUP_STATUSES.map((o) => ({
            value: o,
            label: t(`assets.group.status.${o}`, { defaultValue: o }),
          }))}
          sx={{ flex: 1 }}
          t={t}
        />
      </Stack>
    </>
  );
}

// ── Field primitives ─────────────────────────────────────────────────────────

interface FieldCommon {
  // biome-ignore lint/suspicious/noExplicitAny: dynamic form control
  control: Control<any>;
  t: TFunction;
  sx?: SxProps<Theme>;
  optional?: boolean;
}

function FieldText({
  control,
  name,
  label,
  error,
  t,
  sx,
  optional,
  type = 'text',
  multiline,
  rows,
}: FieldCommon & {
  name: string;
  label: string;
  error?: FieldError;
  type?: string;
  multiline?: boolean;
  rows?: number;
}) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }: { field: ControllerRenderProps }) => (
        <TextField
          {...field}
          value={field.value ?? ''}
          fullWidth
          label={label}
          type={type}
          multiline={multiline}
          rows={rows}
          sx={sx}
          error={Boolean(error)}
          helperText={error ? t(error.message ?? '') : optional ? t('common.optional') : ' '}
        />
      )}
    />
  );
}

function FieldNumber({
  control,
  name,
  label,
  error,
  t,
  sx,
}: FieldCommon & { name: string; label: string; error?: FieldError }) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }: { field: ControllerRenderProps }) => (
        <TextField
          {...field}
          value={field.value ?? ''}
          fullWidth
          label={label}
          type="number"
          sx={sx}
          onChange={(e) => field.onChange(e.target.value === '' ? '' : Number(e.target.value))}
          error={Boolean(error)}
          helperText={error ? t(error.message ?? '') : ' '}
        />
      )}
    />
  );
}

function FieldSelect({
  control,
  name,
  label,
  options,
  t: _t,
  sx,
}: FieldCommon & { name: string; label: string; options: { value: string; label: string }[] }) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }: { field: ControllerRenderProps }) => (
        <TextField
          select
          {...field}
          value={field.value ?? ''}
          fullWidth
          label={label}
          sx={sx}
          helperText=" "
          SelectProps={{ displayEmpty: true }}
        >
          {options.map((o) => (
            <MenuItem key={o.value} value={o.value}>
              {o.label}
            </MenuItem>
          ))}
        </TextField>
      )}
    />
  );
}

// ── Default-values builder ───────────────────────────────────────────────────

function buildDefaults(
  entity: AssetTab,
  record: AssetRecord | undefined,
  isEdit: boolean,
): Record<string, unknown> {
  if (isEdit && record) {
    if (entity === 'vehicles') {
      const v = record as Vehicle;
      return {
        licensePlate: v.licensePlate,
        vin: v.vin,
        make: v.make,
        model: v.model,
        year: v.year,
        type: v.type,
        fuelType: v.fuelType,
        color: v.color,
        status: v.status,
        groupId: v.groupId ?? '',
        deviceId: v.deviceId ?? '',
      };
    }
    if (entity === 'drivers') {
      const d = record as Driver;
      return {
        firstName: d.firstName,
        lastName: d.lastName,
        email: d.email,
        phone: d.phone,
        employeeId: d.employeeId ?? '',
        status: d.status,
        licenseNumber: d.licenseNumber,
        licenseClass: d.licenseClass,
        licenseExpiry: d.licenseExpiry,
        assignedVehicleId: d.assignedVehicleId ?? '',
      };
    }
    if (entity === 'devices') {
      const dev = record as Device;
      return {
        serialNumber: dev.serialNumber,
        deviceType: dev.deviceType,
        manufacturer: dev.manufacturer,
        model: dev.model,
        imei: dev.imei ?? '',
        firmwareVersion: dev.firmwareVersion,
        reportingIntervalSec: dev.reportingIntervalSec,
        status: dev.status,
        boundVehicleId: dev.boundVehicleId ?? '',
      };
    }
    const g = record as VehicleGroup;
    return {
      name: g.name,
      description: g.description,
      vehicleTypeFilter: g.vehicleTypeFilter ?? '',
      status: g.status,
    };
  }
  // Create defaults.
  if (entity === 'vehicles') {
    return {
      licensePlate: '',
      vin: '',
      make: '',
      model: '',
      year: new Date().getFullYear(),
      type: 'truck',
      fuelType: 'diesel',
      color: '',
      status: 'active',
      groupId: '',
      deviceId: '',
    };
  }
  if (entity === 'drivers') {
    return {
      firstName: '',
      lastName: '',
      email: '',
      phone: '',
      employeeId: '',
      status: 'active',
      licenseNumber: '',
      licenseClass: '',
      licenseExpiry: '',
      assignedVehicleId: '',
    };
  }
  if (entity === 'devices') {
    return {
      serialNumber: '',
      deviceType: 'gps_tracker',
      manufacturer: '',
      model: '',
      imei: '',
      firmwareVersion: '',
      reportingIntervalSec: 60,
      status: 'provisioned',
      boundVehicleId: '',
    };
  }
  return { name: '', description: '', vehicleTypeFilter: '', status: 'active' };
}
