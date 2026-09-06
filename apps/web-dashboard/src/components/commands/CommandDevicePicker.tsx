/**
 * CommandDevicePicker — fleet-type filter (menu mode) or a locked single
 * device (opened from the unit itself). No IMEI checklist: menu mode applies
 * the catalog to every ACTIVE device of the chosen model.
 */
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { Button, Card, Select } from '@/components/tailwind-ui';
import { commandClassFromModel } from '@/lib/command-capability';
import type { Device } from '@/types/asset.types';

const ALL_TYPES = '';

interface CommandDevicePickerProps {
  devices: readonly Device[];
  /** Device opened from the unit (map popup / device drawer). */
  lockedDevice?: Device | null;
  /** Selected model in menu mode (empty = none). */
  typeFilter: string;
  onTypeChange: (model: string) => void;
  /** Leave single-device mode and return to type-wide commands. */
  onClearDevice?: () => void;
  loading?: boolean;
  disabled?: boolean;
}

export function CommandDevicePicker({
  devices,
  lockedDevice,
  typeFilter,
  onTypeChange,
  onClearDevice,
  loading,
  disabled,
}: CommandDevicePickerProps) {
  const { t } = useTranslation();

  const deviceTypes = useMemo(() => {
    const counts = new Map<string, number>();
    for (const d of devices) {
      if (!d.model) continue;
      if (d.status !== 'ACTIVE') continue;
      counts.set(d.model, (counts.get(d.model) ?? 0) + 1);
    }
    return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [devices]);

  if (lockedDevice) {
    const klass = commandClassFromModel(lockedDevice.model);
    return (
      <Card
        flush
        className="flex flex-wrap items-center gap-3 p-3"
        data-testid="command-device-scope"
      >
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-gray-800 dark:text-white">
            {t('commands.picker.thisDevice', { defaultValue: 'This device' })}
          </h2>
          <p className="mt-0.5 font-mono text-sm text-gray-800 dark:text-graydark-800">
            {lockedDevice.imei}
            {lockedDevice.model ? (
              <span className="ms-2 font-sans text-xs text-gray-500 dark:text-graydark-600">
                {lockedDevice.model}
              </span>
            ) : null}
          </p>
          <p className="text-xs text-gray-500 dark:text-graydark-600">
            {klass === 'mdvr'
              ? t('commands.picker.classMdvr', { defaultValue: 'MDVR settings for this unit' })
              : t('commands.picker.classTracker', {
                  defaultValue: 'Tracker settings for this unit',
                })}
          </p>
        </div>
        {onClearDevice && (
          <Button type="button" size="sm" variant="outline" onClick={onClearDevice}>
            {t('commands.picker.backToTypes', { defaultValue: 'All device types' })}
          </Button>
        )}
      </Card>
    );
  }

  const selectedCount =
    typeFilter === ALL_TYPES
      ? 0
      : devices.filter((d) => d.model === typeFilter && d.status === 'ACTIVE').length;

  return (
    <Card flush className="flex flex-col gap-3 p-3" data-testid="command-device-picker">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold text-gray-800 dark:text-white">
          {t('commands.picker.typeTitle', { defaultValue: 'Device type' })}
        </h2>
        {typeFilter !== ALL_TYPES && (
          <span className="text-xs text-gray-500 dark:text-graydark-600">
            {t('commands.picker.typeCount', {
              defaultValue: '{{count}} devices of this type',
              count: selectedCount,
            })}
          </span>
        )}
      </div>

      {devices.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-graydark-600">
          {t('commands.noMeitrackDevices', {
            defaultValue: 'No Meitrack devices registered',
          })}
        </p>
      ) : (
        <Select
          value={typeFilter}
          onChange={(e) => onTypeChange(e.target.value)}
          wrapperClassName="w-full max-w-sm"
          disabled={disabled || loading || deviceTypes.length === 0}
          aria-label={t('commands.picker.type', { defaultValue: 'Device type' })}
          options={[
            {
              value: ALL_TYPES,
              label: t('commands.picker.chooseType', { defaultValue: 'Choose a device type…' }),
            },
            ...deviceTypes.map(([model, count]) => ({
              value: model,
              label: `${model} (${count})`,
            })),
          ]}
        />
      )}
    </Card>
  );
}
