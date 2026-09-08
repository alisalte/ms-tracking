/**
 * AlarmLinkSettDrawer — vendor-app “Link Sett” fields for one Meitrack event.
 * Unsupported controls are disabled with tooltips (Phase 1C).
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Alert, Button, Checkbox, Drawer, Input, Tooltip } from '@/components/tailwind-ui';
import {
  ALARM_LINK_SUPPORT,
  type AlarmLinkSett,
  type AlarmParameterEventDef,
  composeAlarmLinkSettCommands,
  isOutputSupported,
} from '@/lib/device-parameter-alarm';

interface AlarmLinkSettDrawerProps {
  open: boolean;
  event: AlarmParameterEventDef | null;
  initial: AlarmLinkSett | null;
  submitting?: boolean;
  onClose: () => void;
  onApply: (sett: AlarmLinkSett) => void;
}

function UnsupportedCheckbox({
  checked,
  label,
  tip,
  testId,
}: {
  checked: boolean;
  label: string;
  tip: string;
  testId?: string;
}) {
  return (
    <Tooltip label={tip}>
      <span data-testid={testId}>
        <Checkbox checked={checked} disabled label={label} />
      </span>
    </Tooltip>
  );
}

export function AlarmLinkSettDrawer({
  open,
  event,
  initial,
  submitting = false,
  onClose,
  onApply,
}: AlarmLinkSettDrawerProps) {
  const { t } = useTranslation();
  const [sett, setSett] = useState<AlarmLinkSett | null>(initial);

  useEffect(() => {
    if (open && initial) setSett(initial);
  }, [open, initial]);

  const unsupportedTip = t('commands.parameter.unsupportedFieldTip', {
    defaultValue: 'Not supported on this firmware path yet.',
  });

  if (!event || !sett) {
    return (
      <Drawer open={open} onClose={onClose} title={t('commands.parameter.linkSett')} size="md">
        <p className="text-sm text-gray-500">{t('common.loading')}</p>
      </Drawer>
    );
  }

  const preview = composeAlarmLinkSettCommands(sett);
  const unsupported = preview.filter((c) => c.unsupported);

  const setPhone = (idx: number, patch: Partial<(typeof sett.phones)[0]>) => {
    setSett({
      ...sett,
      phones: sett.phones.map((p, i) => (i === idx ? { ...p, ...patch } : p)),
    });
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      backdrop="blocking"
      size="md"
      title={t('commands.parameter.linkSett')}
      subtitle={t(`commands.parameter.events.${event.labelKey}`, {
        defaultValue: event.defaultAlarmHead,
      })}
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>
            {t('common.cancel', { defaultValue: 'Cancel' })}
          </Button>
          <Button
            type="button"
            loading={submitting}
            onClick={() => onApply(sett)}
            data-testid="alarm-link-sett-apply"
          >
            {t('commands.parameter.setting', { defaultValue: 'Setting' })}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        <Alert variant="info">
          {t('commands.parameter.onDeviceHint', {
            defaultValue:
              'These settings are written to the physical device (not server Alarm Rules).',
          })}
        </Alert>

        {sett.phones.map((phone, idx) => (
          <div
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed-position phone slots never reorder
            key={`phone-${idx}`}
            className="flex flex-col gap-2 rounded-lg border border-gray-200 p-3 dark:border-white/10"
          >
            <p className="text-sm font-medium text-gray-800 dark:text-white">
              {t('commands.parameter.associatedPhone', { defaultValue: 'Associated phone' })}{' '}
              {idx + 1}
            </p>
            <Input
              value={phone.number}
              onChange={(e) => setPhone(idx, { number: e.target.value })}
              placeholder={t('commands.parameter.phonePlaceholder', {
                defaultValue: 'Please enter the associate',
              })}
              aria-label={`${t('commands.parameter.associatedPhone')} ${idx + 1}`}
            />
            <div className="flex gap-4">
              <Checkbox
                checked={phone.sms}
                onChange={(e) => setPhone(idx, { sms: e.target.checked })}
                label={t('commands.parameter.sms', { defaultValue: 'SMS' })}
              />
              <Checkbox
                checked={phone.call}
                onChange={(e) => setPhone(idx, { call: e.target.checked })}
                label={t('commands.parameter.call', { defaultValue: 'Call' })}
              />
            </div>
          </div>
        ))}

        <Input
          label={t('commands.parameter.alarmHead', { defaultValue: 'Alarm head' })}
          value={sett.alarmHead}
          onChange={(e) => setSett({ ...sett, alarmHead: e.target.value })}
          maxLength={16}
        />

        <Input
          label={t('commands.parameter.delayRecording', {
            defaultValue: 'Delay recording time (S)',
          })}
          type="number"
          min={0}
          max={255}
          value={String(sett.delayRecordingSec)}
          onChange={(e) => setSett({ ...sett, delayRecordingSec: Number(e.target.value) || 0 })}
          hint={t('commands.parameter.delayHint', {
            defaultValue: 'Applied with CH Recording via CB8.',
          })}
        />

        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium text-gray-800 dark:text-white">
            {t('commands.parameter.transferLinkage', { defaultValue: 'Alarm transfer linkage' })}
          </legend>
          <div className="flex flex-wrap gap-4">
            <Checkbox
              checked={sett.transferGprs}
              onChange={(e) => setSett({ ...sett, transferGprs: e.target.checked })}
              label="GPRS"
            />
            {ALARM_LINK_SUPPORT.transferFtp ? (
              <Checkbox
                checked={sett.transferFtp}
                onChange={(e) => setSett({ ...sett, transferFtp: e.target.checked })}
                label="FTP"
              />
            ) : (
              <UnsupportedCheckbox
                checked={sett.transferFtp}
                label="FTP"
                tip={unsupportedTip}
                testId="alarm-link-unsupported-ftp"
              />
            )}
            {ALARM_LINK_SUPPORT.transferVoice ? (
              <Checkbox
                checked={sett.transferVoice}
                onChange={(e) => setSett({ ...sett, transferVoice: e.target.checked })}
                label="VOICE"
              />
            ) : (
              <UnsupportedCheckbox
                checked={sett.transferVoice}
                label="VOICE"
                tip={unsupportedTip}
                testId="alarm-link-unsupported-voice"
              />
            )}
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium text-gray-800 dark:text-white">
            {t('commands.parameter.outputLinkage', { defaultValue: 'Alarm output linkage' })}
          </legend>
          <div className="flex flex-wrap gap-3">
            {sett.outputs.map((on, i) =>
              isOutputSupported(i) ? (
                <Checkbox
                  // biome-ignore lint/suspicious/noArrayIndexKey: fixed-position output slots never reorder
                  key={`out-${i}`}
                  checked={on}
                  onChange={(e) => {
                    const outputs = [...sett.outputs];
                    outputs[i] = e.target.checked;
                    setSett({ ...sett, outputs });
                  }}
                  label={`Output${i + 1}`}
                />
              ) : (
                <UnsupportedCheckbox
                  // biome-ignore lint/suspicious/noArrayIndexKey: fixed-position output slots never reorder
                  key={`out-${i}`}
                  checked={on}
                  label={`Output${i + 1}`}
                  tip={unsupportedTip}
                  testId={`alarm-link-unsupported-out-${i + 1}`}
                />
              ),
            )}
          </div>
          <p className="text-xs text-gray-500 dark:text-graydark-600">
            {t('commands.parameter.outputHint', {
              defaultValue:
                'Outputs 1–2 are sent via device auth; 3–7 are disabled until catalog support exists.',
            })}
          </p>
        </fieldset>

        {[0, 1, 2, 3].map((ch) => (
          <fieldset key={`ch-${ch}`} className="flex flex-wrap items-center gap-3">
            <legend className="w-full text-sm font-medium text-gray-800 dark:text-white">
              CH{ch + 1}
            </legend>
            <Checkbox
              checked={sett.channelRecording[ch] ?? false}
              onChange={(e) => {
                const channelRecording = [...sett.channelRecording];
                channelRecording[ch] = e.target.checked;
                setSett({ ...sett, channelRecording });
              }}
              label={t('commands.parameter.recording', { defaultValue: 'Recording' })}
            />
            {ALARM_LINK_SUPPORT.channelScreenshot ? (
              <Checkbox
                checked={sett.channelScreenshot[ch] ?? false}
                onChange={(e) => {
                  const channelScreenshot = [...sett.channelScreenshot];
                  channelScreenshot[ch] = e.target.checked;
                  setSett({ ...sett, channelScreenshot });
                }}
                label={t('commands.parameter.screenshot', { defaultValue: 'Screenshot' })}
              />
            ) : (
              <UnsupportedCheckbox
                checked={sett.channelScreenshot[ch] ?? false}
                label={t('commands.parameter.screenshot', { defaultValue: 'Screenshot' })}
                tip={unsupportedTip}
                testId={`alarm-link-unsupported-shot-${ch + 1}`}
              />
            )}
            {ALARM_LINK_SUPPORT.channelOsd ? (
              <Checkbox
                checked={sett.channelOsd[ch] ?? false}
                onChange={(e) => {
                  const channelOsd = [...sett.channelOsd];
                  channelOsd[ch] = e.target.checked;
                  setSett({ ...sett, channelOsd });
                }}
                label="OSD"
              />
            ) : (
              <UnsupportedCheckbox
                checked={sett.channelOsd[ch] ?? false}
                label="OSD"
                tip={unsupportedTip}
                testId={`alarm-link-unsupported-osd-${ch + 1}`}
              />
            )}
          </fieldset>
        ))}

        {unsupported.length > 0 && (
          <Alert variant="warning">
            {t('commands.parameter.unsupportedHint', {
              defaultValue:
                'Disabled options (FTP, VOICE, Screenshot, OSD, Output 3+) are not sent on this firmware path.',
            })}
          </Alert>
        )}
      </div>
    </Drawer>
  );
}
