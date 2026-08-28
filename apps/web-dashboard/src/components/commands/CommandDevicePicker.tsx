/**
 * CommandDevicePicker — multi-select Meitrack devices so one catalog command
 * (interval, APN, alerts, …) can be queued on many units at once.
 */
import { Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button, Card, Checkbox, Input } from '@/components/tailwind-ui';
import type { Device } from '@/types/asset.types';

interface CommandDevicePickerProps {
  devices: readonly Device[];
  selectedIds: readonly string[];
  onChange: (ids: string[]) => void;
  loading?: boolean;
  disabled?: boolean;
}

export function CommandDevicePicker({
  devices,
  selectedIds,
  onChange,
  loading,
  disabled,
}: CommandDevicePickerProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return devices;
    return devices.filter((d) => {
      const model = (d.model ?? '').toLowerCase();
      return d.imei.toLowerCase().includes(q) || model.includes(q);
    });
  }, [devices, query]);

  const selectable = useMemo(() => filtered.filter((d) => d.status === 'ACTIVE'), [filtered]);
  const selectableIds = selectable.map((d) => d.id);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const allVisibleSelected =
    selectableIds.length > 0 && selectableIds.every((id) => selectedSet.has(id));

  const toggleOne = (id: string, eligible: boolean) => {
    if (!eligible || disabled) return;
    onChange(selectedSet.has(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id]);
  };

  const selectVisible = () => {
    onChange([...new Set([...selectedIds, ...selectableIds])]);
  };

  const clearVisible = () => {
    const drop = new Set(selectableIds);
    onChange(selectedIds.filter((id) => !drop.has(id)));
  };

  return (
    <Card flush className="flex flex-col gap-3 p-3" data-testid="command-device-picker">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold text-gray-800 dark:text-white">
          {t('commands.picker.title', { defaultValue: 'Devices' })}
        </h2>
        <span className="text-xs text-gray-500 dark:text-graydark-600">
          {t('commands.picker.selectedCount', {
            defaultValue: '{{selected}} of {{total}} selected',
            selected: selectedIds.length,
            total: devices.length,
          })}
        </span>
        <div className="ms-auto flex flex-wrap gap-1.5">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={disabled || loading || selectableIds.length === 0}
            onClick={allVisibleSelected ? clearVisible : selectVisible}
          >
            {allVisibleSelected
              ? t('commands.picker.clearVisible', { defaultValue: 'Clear visible' })
              : t('commands.picker.selectAll', { defaultValue: 'Select all' })}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={disabled || selectedIds.length === 0}
            onClick={() => onChange([])}
          >
            {t('common.clear', { defaultValue: 'Clear' })}
          </Button>
        </div>
      </div>

      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t('commands.picker.search', {
          defaultValue: 'Filter by IMEI or model…',
        })}
        aria-label={t('commands.picker.search', {
          defaultValue: 'Filter by IMEI or model…',
        })}
        leftIcon={<Search size={14} />}
        disabled={disabled || loading}
      />

      {devices.length === 0 ? (
        <p className="p-2 text-sm text-gray-500 dark:text-graydark-600">
          {t('commands.noMeitrackDevices', {
            defaultValue: 'No Meitrack devices registered',
          })}
        </p>
      ) : (
        <ul className="max-h-56 overflow-y-auto rounded-lg border border-gray-200 dark:border-white/10">
          {filtered.length === 0 && (
            <li className="px-3 py-2 text-sm text-gray-500 dark:text-graydark-600">
              {t('commands.picker.noMatch', { defaultValue: 'No devices match.' })}
            </li>
          )}
          {filtered.map((d) => {
            const eligible = d.status === 'ACTIVE';
            return (
              <li
                key={d.id}
                className="border-b border-gray-100 px-3 py-1.5 last:border-b-0 dark:border-white/5"
              >
                <Checkbox
                  checked={selectedSet.has(d.id)}
                  disabled={disabled || !eligible}
                  onChange={() => toggleOne(d.id, eligible)}
                  label={
                    <span className="flex flex-wrap items-baseline gap-x-2">
                      <span className="font-mono text-sm">{d.imei}</span>
                      {d.model && (
                        <span className="text-xs text-gray-500 dark:text-graydark-600">
                          {d.model}
                        </span>
                      )}
                      {!eligible && <span className="text-xs text-gray-400">{d.status}</span>}
                    </span>
                  }
                />
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
