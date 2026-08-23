/**
 * AssetFormDrawer — one reusable slide-over drawer for creating OR editing
 * the three REAL asset entities (Fleet / Vehicle / Device).
 *
 * - Selects the right zod schema + field set per `entity` (Sprint E §10
 *   contracts: fleet {name, code, description?}; vehicle {fleetId, name,
 *   code, plate?, vin?}; device {imei, serialNumber?, manufacturer?, model?,
 *   protocol} + status on edit — imei is immutable server-side, so edit mode
 *   renders it read-only).
 * - The IMEI is validated client-side: exactly 15 digits AND Luhn-valid
 *   (the backend applies the same check; 422 otherwise).
 * - Edit mode prefills from `record`; create mode starts empty.
 * - Submits via the matching create/update hook; 409 ConflictError maps to a
 *   friendly "code/IMEI clash" message, other backend errors surface via
 *   getApiErrorMessage. Shown inline via the tailwind `Alert` + toasted.
 */
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useMemo, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import {
  useCreateDevice,
  useCreateFleet,
  useCreateVehicle,
  useUpdateDevice,
  useUpdateFleet,
  useUpdateVehicle,
} from '@/api/asset.api';
import { ConflictError, getApiErrorMessage } from '@/api/errors';
import { useToast } from '@/components/feedback/ToastProvider';
import {
  Alert,
  Button,
  Drawer,
  Input,
  Select,
  type SelectOption,
  Textarea,
} from '@/components/tailwind-ui';
import type { AssetTab } from '@/pages/AssetManagementPage';
import type {
  CreateDevicePayload,
  CreateFleetPayload,
  CreateVehiclePayload,
  Device,
  DeviceProtocol,
  DeviceStatus,
  Fleet,
  UpdateDevicePayload,
  Vehicle,
} from '@/types/asset.types';

/** The discriminated record a drawer can edit (create omits the record). */
export type AssetRecord = Fleet | Vehicle | Device;

export interface AssetFormDrawerProps {
  open: boolean;
  mode: 'create' | 'edit';
  entity: AssetTab;
  /** For edit mode: the record being edited. Omit for create. */
  record?: AssetRecord;
  /** Fleet registry — powers the vehicle form's fleet select. */
  fleets?: Fleet[];
  onClose: () => void;
  /** Invoked after a successful create/update (the hook already invalidated). */
  onSuccess?: () => void;
}

// ── Validation schemas (messages are i18n keys translated via t()) ──────────

/** Luhn checksum (ISO/IEC 7812-1) — required for real IMEIs. */
function luhnValid(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i += 1) {
    let n = Number(digits[digits.length - 1 - i]);
    if (Number.isNaN(n)) return false;
    if (i % 2 === 1) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
  }
  return sum % 10 === 0;
}

/** Short unique code — `[A-Za-z0-9_-]`, 1–64 (backend rule). */
const codeSchema = (keys: { required: string; tooLong: string; invalid: string }) =>
  z
    .string()
    .trim()
    .min(1, { message: keys.required })
    .max(64, { message: keys.tooLong })
    .regex(/^[A-Za-z0-9_-]+$/, { message: keys.invalid });

const optionalText = (max: number, tooLong: string) =>
  z.string().trim().max(max, { message: tooLong });

/** Fleet create/edit (CreateFleetPayload — PATCH is a full replace). */
const fleetSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, { message: 'validation.fleet.nameRequired' })
    .max(200, { message: 'validation.fleet.nameTooLong' }),
  code: codeSchema({
    required: 'validation.fleet.codeRequired',
    tooLong: 'validation.fleet.codeTooLong',
    invalid: 'validation.fleet.codeInvalid',
  }),
  description: optionalText(1000, 'validation.fleet.descriptionTooLong'),
});

/** Vehicle create/edit (CreateVehiclePayload). */
const vehicleSchema = z.object({
  fleetId: z.string().min(1, { message: 'validation.vehicle.fleetRequired' }),
  name: z
    .string()
    .trim()
    .min(1, { message: 'validation.vehicle.nameRequired' })
    .max(200, { message: 'validation.vehicle.nameTooLong' }),
  code: codeSchema({
    required: 'validation.vehicle.codeRequired',
    tooLong: 'validation.vehicle.codeTooLong',
    invalid: 'validation.vehicle.codeInvalid',
  }),
  plate: optionalText(32, 'validation.vehicle.plateTooLong'),
  /** 17 chars, no I/O/Q (ISO 3779) — empty allowed. */
  vin: z
    .string()
    .trim()
    .refine((v) => v === '' || /^[A-HJ-NPR-Z0-9]{17}$/i.test(v), {
      message: 'validation.vehicle.vinInvalid',
    }),
});

/** Device create — IMEI is the immutable global identity: 15 digits + Luhn. */
const deviceCreateSchema = z.object({
  imei: z
    .string()
    .trim()
    .regex(/^\d{15}$/, { message: 'validation.device.imeiFormat' })
    .refine(luhnValid, { message: 'validation.device.imeiLuhn' }),
  serialNumber: optionalText(64, 'validation.device.imeiFormat'),
  manufacturer: optionalText(100, 'validation.device.imeiFormat'),
  model: optionalText(100, 'validation.device.imeiFormat'),
  protocol: z.enum(['gt06', 'jt808', 'meitrack', 'stub'], {
    message: 'validation.device.protocolRequired',
  }),
});

/** Device edit — imei read-only; registry fields + lifecycle status editable. */
const deviceEditSchema = z.object({
  serialNumber: optionalText(64, 'validation.device.imeiFormat'),
  manufacturer: optionalText(100, 'validation.device.imeiFormat'),
  model: optionalText(100, 'validation.device.imeiFormat'),
  protocol: z.enum(['gt06', 'jt808', 'meitrack', 'stub']),
  status: z.enum(['ACTIVE', 'SUSPENDED', 'DECOMMISSIONED', 'UNPAIRED']),
});

const PROTOCOL_OPTIONS: DeviceProtocol[] = ['gt06', 'jt808', 'meitrack', 'stub'];
const DEVICE_STATUS_OPTIONS: DeviceStatus[] = ['ACTIVE', 'SUSPENDED', 'UNPAIRED', 'DECOMMISSIONED'];

export function AssetFormDrawer({
  open,
  mode,
  entity,
  record,
  fleets = [],
  onClose,
  onSuccess,
}: AssetFormDrawerProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const isEdit = mode === 'edit';

  // Per-entity create/update hooks.
  const createFleet = useCreateFleet();
  const updateFleet = useUpdateFleet();
  const createVehicle = useCreateVehicle();
  const updateVehicle = useUpdateVehicle();
  const createDevice = useCreateDevice();
  const updateDevice = useUpdateDevice();

  const schema = useMemo(
    () =>
      entity === 'fleets'
        ? fleetSchema
        : entity === 'vehicles'
          ? vehicleSchema
          : isEdit
            ? deviceEditSchema
            : deviceCreateSchema,
    [entity, isEdit],
  );

  const defaultValues = useMemo(
    () => buildDefaults(entity, record, isEdit),
    [entity, record, isEdit],
  );

  const {
    control,
    handleSubmit,
    reset,
    formState: { errors },
    // Form values are dynamic across entities (fleet/vehicle/device), so the
    // values type is intentionally loose; payloads are cast at the call site.
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

  const isPending =
    entity === 'fleets'
      ? isEdit
        ? updateFleet.isPending
        : createFleet.isPending
      : entity === 'vehicles'
        ? isEdit
          ? updateVehicle.isPending
          : createVehicle.isPending
        : isEdit
          ? updateDevice.isPending
          : createDevice.isPending;

  const entityLabelKey = `assets.tabs.${entity}`;

  const onSubmit = async (values: Record<string, unknown>) => {
    setServerError(null);
    try {
      if (entity === 'fleets') {
        const payload: CreateFleetPayload = {
          name: String(values.name),
          code: String(values.code),
          ...(values.description ? { description: String(values.description) } : {}),
        };
        if (isEdit && record) {
          await updateFleet.mutateAsync({ id: record.id, changes: payload });
        } else {
          await createFleet.mutateAsync(payload);
        }
      } else if (entity === 'vehicles') {
        const payload: CreateVehiclePayload = {
          fleetId: String(values.fleetId),
          name: String(values.name),
          code: String(values.code),
          ...(values.plate ? { plate: String(values.plate) } : {}),
          ...(values.vin ? { vin: String(values.vin).toUpperCase() } : {}),
        };
        if (isEdit && record) {
          await updateVehicle.mutateAsync({ id: record.id, changes: payload });
        } else {
          await createVehicle.mutateAsync(payload);
        }
      } else {
        // Devices — create takes the IMEI; edit never sends it (immutable).
        if (isEdit && record) {
          const changes: UpdateDevicePayload = {
            protocol: values.protocol as DeviceProtocol,
            status: values.status as DeviceStatus,
            ...(values.serialNumber ? { serialNumber: String(values.serialNumber) } : {}),
            ...(values.manufacturer ? { manufacturer: String(values.manufacturer) } : {}),
            ...(values.model ? { model: String(values.model) } : {}),
          };
          await updateDevice.mutateAsync({ id: record.id, changes });
        } else {
          const payload: CreateDevicePayload = {
            imei: String(values.imei),
            protocol: values.protocol as DeviceProtocol,
            ...(values.serialNumber ? { serialNumber: String(values.serialNumber) } : {}),
            ...(values.manufacturer ? { manufacturer: String(values.manufacturer) } : {}),
            ...(values.model ? { model: String(values.model) } : {}),
          };
          await createDevice.mutateAsync(payload);
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
      // 409 → friendly conflict copy (code clash / duplicate IMEI); other
      // backend validation errors surface verbatim via getApiErrorMessage.
      const msg =
        err instanceof ConflictError ? t('assets.crud.conflict') : getApiErrorMessage(err);
      setServerError(msg);
      toast.error(msg);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={`${t(isEdit ? 'common.edit' : 'common.add')} ${t(entityLabelKey)}`}
      subtitle={t(entityLabelKey)}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="asset-form" loading={isPending}>
            {isPending ? t('common.submitting') : t(isEdit ? 'common.save' : 'common.create')}
          </Button>
        </>
      }
    >
      <form
        id="asset-form"
        onSubmit={handleSubmit(onSubmit)}
        noValidate
        className="flex flex-col gap-4"
      >
        {serverError && <Alert variant="danger">{serverError}</Alert>}

        {entity === 'fleets' && <FleetFields control={control} errors={errors} t={t} />}
        {entity === 'vehicles' && (
          <VehicleFields control={control} errors={errors} fleets={fleets} t={t} />
        )}
        {entity === 'devices' && (
          <DeviceFields
            control={control}
            errors={errors}
            isEdit={isEdit}
            imei={record && entity === 'devices' ? (record as Device).imei : undefined}
            t={t}
          />
        )}

        <p className="mt-2 text-xs text-gray-500 dark:text-graydark-600">
          {t('validation.asteriskHelp', { defaultValue: '* = required field' })}
        </p>
      </form>
    </Drawer>
  );
}

// ── Per-entity field sets ────────────────────────────────────────────────────
// Each renders tailwind Input / Select / Textarea via <Controller>. Required
// fields carry a trailing " *" in the label and zod-enforced validation.

import type { TFunction } from 'i18next';
import type { Control, FieldError, FieldErrors } from 'react-hook-form';

interface FieldProps {
  // biome-ignore lint/suspicious/noExplicitAny: form values are dynamic across entities
  control: Control<any>;
  // biome-ignore lint/suspicious/noExplicitAny: errors are dynamic across entities
  errors: FieldErrors<any>;
  t: TFunction;
}

function FleetFields({ control, errors, t }: FieldProps) {
  return (
    <>
      <FieldText
        control={control}
        name="name"
        label={`${t('assets.fleet.name')} *`}
        error={errors.name as FieldError | undefined}
        t={t}
      />
      <FieldText
        control={control}
        name="code"
        label={`${t('assets.fleet.code')} *`}
        error={errors.code as FieldError | undefined}
        t={t}
      />
      <FieldText
        control={control}
        name="description"
        label={t('assets.fleet.description')}
        multiline
        rows={3}
        optional
        t={t}
      />
    </>
  );
}

function VehicleFields({ control, errors, fleets, t }: FieldProps & { fleets: Fleet[] }) {
  // Active fleets first; keep the currently-archived ones selectable so edits
  // of vehicles in archived fleets don't silently change the assignment.
  const options = [...fleets].sort(
    (a, b) => Number(b.status === 'ACTIVE') - Number(a.status === 'ACTIVE'),
  );
  return (
    <>
      <FieldSelect
        control={control}
        name="fleetId"
        label={`${t('assets.vehicle.fleet')} *`}
        options={options.map((f) => ({
          value: f.id,
          label:
            f.status === 'ACTIVE' ? f.name : `${f.name} (${t('assets.fleet.status.ARCHIVED')})`,
        }))}
        error={errors.fleetId as FieldError | undefined}
        t={t}
      />
      <FieldText
        control={control}
        name="name"
        label={`${t('assets.vehicle.name')} *`}
        error={errors.name as FieldError | undefined}
        t={t}
      />
      <FieldText
        control={control}
        name="code"
        label={`${t('assets.vehicle.code')} *`}
        error={errors.code as FieldError | undefined}
        t={t}
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FieldText
          control={control}
          name="plate"
          label={t('assets.vehicle.plate')}
          optional
          error={errors.plate as FieldError | undefined}
          t={t}
        />
        <FieldText
          control={control}
          name="vin"
          label={t('assets.vehicle.vin')}
          optional
          error={errors.vin as FieldError | undefined}
          t={t}
        />
      </div>
    </>
  );
}

function DeviceFields({
  control,
  errors,
  isEdit,
  imei,
  t,
}: FieldProps & { isEdit: boolean; imei?: string }) {
  return (
    <>
      {isEdit ? (
        // IMEI is the immutable physical identity — display-only on edit.
        <Input
          label={t('assets.device.imei')}
          value={imei ?? ''}
          readOnly
          className="font-mono"
          hint=" "
        />
      ) : (
        <FieldText
          control={control}
          name="imei"
          label={`${t('assets.device.imei')} *`}
          error={errors.imei as FieldError | undefined}
          t={t}
          mono
        />
      )}
      <FieldText
        control={control}
        name="serialNumber"
        label={t('assets.device.serial')}
        optional
        error={errors.serialNumber as FieldError | undefined}
        t={t}
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FieldText
          control={control}
          name="manufacturer"
          label={t('assets.device.manufacturer')}
          optional
          error={errors.manufacturer as FieldError | undefined}
          t={t}
        />
        <FieldText
          control={control}
          name="model"
          label={t('assets.device.model')}
          optional
          error={errors.model as FieldError | undefined}
          t={t}
        />
      </div>
      <FieldSelect
        control={control}
        name="protocol"
        label={`${t('assets.device.protocol')} *`}
        options={PROTOCOL_OPTIONS.map((p) => ({
          value: p,
          label: t(`assets.device.protocols.${p}`),
        }))}
        error={errors.protocol as FieldError | undefined}
        t={t}
      />
      {isEdit && (
        <FieldSelect
          control={control}
          name="status"
          label={t('assets.device.status')}
          options={DEVICE_STATUS_OPTIONS.map((s) => ({
            value: s,
            label: t(`assets.device.statusValues.${s}`),
          }))}
          error={errors.status as FieldError | undefined}
          t={t}
        />
      )}
    </>
  );
}

// ── Field primitives ─────────────────────────────────────────────────────────

interface FieldCommon {
  // biome-ignore lint/suspicious/noExplicitAny: dynamic form control
  control: Control<any>;
  t: TFunction;
  optional?: boolean;
}

function FieldText({
  control,
  name,
  label,
  error,
  t,
  optional,
  type = 'text',
  multiline,
  rows,
  mono,
}: FieldCommon & {
  name: string;
  label: string;
  error?: FieldError;
  type?: string;
  multiline?: boolean;
  rows?: number;
  mono?: boolean;
}) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) =>
        multiline ? (
          <Textarea
            {...field}
            value={field.value ?? ''}
            label={label}
            rows={rows ?? 3}
            error={error ? t(error.message ?? '') : null}
            hint={error ? null : optional ? t('common.optional') : null}
          />
        ) : (
          <Input
            {...field}
            value={field.value ?? ''}
            label={label}
            type={type}
            className={mono ? 'font-mono' : ''}
            error={error ? t(error.message ?? '') : null}
            hint={error ? null : optional ? t('common.optional') : null}
          />
        )
      }
    />
  );
}

function FieldSelect({
  control,
  name,
  label,
  options,
  t,
  error,
}: FieldCommon & {
  name: string;
  label: string;
  options: SelectOption[];
  error?: FieldError;
}) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <Select
          {...field}
          value={field.value ?? ''}
          label={label}
          options={options}
          error={error ? t(error.message ?? '') : null}
        />
      )}
    />
  );
}

// ── Default-values builder ───────────────────────────────────────────────────

function buildDefaults(
  entity: AssetTab,
  record: AssetRecord | undefined,
  isEdit: boolean,
): Record<string, string> {
  if (isEdit && record) {
    if (entity === 'fleets') {
      const f = record as Fleet;
      return { name: f.name, code: f.code, description: f.description ?? '' };
    }
    if (entity === 'vehicles') {
      const v = record as Vehicle;
      return {
        fleetId: v.fleetId,
        name: v.name,
        code: v.code,
        plate: v.plate ?? '',
        vin: v.vin ?? '',
      };
    }
    const d = record as Device;
    return {
      serialNumber: d.serialNumber ?? '',
      manufacturer: d.manufacturer ?? '',
      model: d.model ?? '',
      protocol: d.protocol,
      status: d.status,
    };
  }
  // Create defaults.
  if (entity === 'fleets') return { name: '', code: '', description: '' };
  if (entity === 'vehicles') return { fleetId: '', name: '', code: '', plate: '', vin: '' };
  return { imei: '', serialNumber: '', manufacturer: '', model: '', protocol: 'gt06' };
}
