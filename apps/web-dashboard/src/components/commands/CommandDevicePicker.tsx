/**
 * CommandDevicePicker — protocol filter (menu mode) or a locked single device.
 * Menu mode applies Parameter to every ACTIVE device of the chosen protocol.
 */
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { Button, Card, Select } from '@/components/tailwind-ui';
import { commandClassFromModel } from '@/lib/command-capability';
import type { Device, DeviceProtocol } from '@/types/asset.types';

const ALL_PROTOCOLS = '';

const PROTOCOL_LABEL: Record<DeviceProtocol, string> = {
  meitrack: 'Meitrack',
  jt808: 'JT/T 808',
  gt06: 'GT06',
  stub: 'Stub',
};

interface CommandDevicePickerProps {
  devices: readonly Device[];
  /** Device opened from the unit (map popup / device drawer). */
  lockedDevice?: Device | null;
  /** Selected protocol in menu mode (empty = none). */
  protocolFilter: string;
  onProtocolChange: (protocol: string) => void;
  /** Leave single-device mode and return to protocol-wide scope. */
  onClearDevice?: () => void;
  loading?: boolean;
  disabled?: boolean;
}

export function CommandDevicePicker({
  devices,
  lockedDevice,
  protocolFilter,
  onProtocolChange,
  onClearDevice,
  loading,
  disabled,
}: CommandDevicePickerProps) {
  const { t } = useTranslation();

  const protocols = useMemo(() => {
    const counts = new Map<string, number>();
    for (const d of devices) {
      if (d.status !== 'ACTIVE') continue;
      counts.set(d.protocol, (counts.get(d.protocol) ?? 0) + 1);
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
            <span className="ms-2 font-sans text-xs text-gray-500 dark:text-graydark-600">
              {PROTOCOL_LABEL[lockedDevice.protocol] ?? lockedDevice.protocol}
              {lockedDevice.model ? ` · ${lockedDevice.model}` : ''}
            </span>
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
            {t('commands.picker.backToProtocols', { defaultValue: 'All protocols' })}
          </Button>
        )}
      </Card>
    );
  }

  const selectedCount =
    protocolFilter === ALL_PROTOCOLS
      ? 0
      : devices.filter((d) => d.protocol === protocolFilter && d.status === 'ACTIVE').length;

  return (
    <Card flush className="flex flex-col gap-3 p-3" data-testid="command-device-picker">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold text-gray-800 dark:text-white">
          {t('commands.picker.protocolTitle', { defaultValue: 'Protocol' })}
        </h2>
        {protocolFilter !== ALL_PROTOCOLS && (
          <span className="text-xs text-gray-500 dark:text-graydark-600">
            {t('commands.picker.protocolCount', {
              defaultValue: '{{count}} active devices',
              count: selectedCount,
            })}
          </span>
        )}
      </div>

      {devices.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-graydark-600">
          {t('commands.noDevices', {
            defaultValue: 'No devices registered',
          })}
        </p>
      ) : (
        <Select
          value={protocolFilter}
          onChange={(e) => onProtocolChange(e.target.value)}
          wrapperClassName="w-full max-w-sm"
          disabled={disabled || loading || protocols.length === 0}
          aria-label={t('commands.picker.protocol', { defaultValue: 'Protocol' })}
          options={[
            {
              value: ALL_PROTOCOLS,
              label: t('commands.picker.chooseProtocol', {
                defaultValue: 'Choose a protocol…',
              }),
            },
            ...protocols.map(([protocol, count]) => ({
              value: protocol,
              label: `${PROTOCOL_LABEL[protocol as DeviceProtocol] ?? protocol} (${count})`,
            })),
          ]}
        />
      )}
    </Card>
  );
}
