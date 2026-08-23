/**
 * DeviceConfigWizard — the guided ALL-TCP-settings flow for one MDVR device.
 *
 * One drawer, three zones:
 *  1. Step rail — device selection → every catalog category that has
 *     TCP-settable commands (network, tracking, media, alerts, …) → the live
 *     test step. The rail shows per-category command counts.
 *  2. Command cards — for the active category, one card per catalog command:
 *     code chip + bilingual name/description + the shared dynamic param form
 *     (CommandParamForm) + an ACK-status chip fed by the polling command
 *     history (QUEUED → SENT → ACKED/FAILED).
 *  3. Live test — camera-channel registration + A9A/A9B stream test + the
 *     Persian SMS cheat-sheet (bring-up over SMS when TCP isn't up yet).
 *
 * Every command in the Meitrack MDVR catalog (fleet-management, GET
 * /device-commands/catalog) is TCP-settable through the same Kafka →
 * device-gateway path, so this wizard is a single surface for the WHOLE
 * device configuration surface — not just video.
 */
import { AlertTriangle, Camera, CheckCircle2, HelpCircle, Radio, Video } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useDevices } from '@/api/asset.api';
import { useCommandCatalog, useCommandHistory, useSendDeviceCommand } from '@/api/command.api';
import { useRegisterChannel, useStartMdvrStream, useStopMdvrStream } from '@/api/video.api';
import { CommandParamForm } from '@/components/commands/CommandParamForm';
import { Alert, Badge, Button, Drawer, Input, Select } from '@/components/tailwind-ui';
import type { CommandCategory, CommandDef, CommandStatus } from '@/types/command.types';

/** Wizard step ids: 'device' | a catalog category | 'test'. */
type StepId = 'device' | CommandCategory | 'test';

interface DeviceConfigWizardProps {
  open: boolean;
  onClose: () => void;
}

export function DeviceConfigWizard({ open, onClose }: DeviceConfigWizardProps) {
  const { t, i18n } = useTranslation();
  const fa = i18n.language?.startsWith('fa');

  const [deviceId, setDeviceId] = useState('');
  const [step, setStep] = useState<StepId>('device');
  const [channelLabel, setChannelLabel] = useState('');
  const [channelNo, setChannelNo] = useState('1');
  const [showHelp, setShowHelp] = useState(false);

  const devices = useDevices();
  const catalog = useCommandCatalog();
  const history = useCommandHistory(deviceId || null);
  const sendCommand = useSendDeviceCommand(deviceId || null);
  const registerChannel = useRegisterChannel();
  const startStream = useStartMdvrStream();
  const stopStream = useStopMdvrStream();

  const device = useMemo(
    () => devices.data?.find((d) => d.id === deviceId) ?? null,
    [devices.data, deviceId],
  );

  /** Commands grouped per category, in catalog order. */
  const byCategory = useMemo(() => {
    const map = new Map<CommandCategory, CommandDef[]>();
    for (const cmd of catalog.data ?? []) {
      const list = map.get(cmd.category) ?? [];
      list.push(cmd);
      map.set(cmd.category, list);
    }
    return map;
  }, [catalog.data]);

  /** Step rail entries present in the catalog. */
  const categorySteps = useMemo(
    () =>
      [...byCategory.entries()].sort(
        (a, b) => CATEGORY_ORDER.indexOf(a[0]) - CATEGORY_ORDER.indexOf(b[0]),
      ),
    [byCategory],
  );

  /** Latest record per commandCode (for the per-card status chip). */
  const latestByCode = useMemo(() => {
    const map = new Map<string, CommandStatus>();
    for (const rec of history.data ?? []) {
      if (!map.has(rec.commandCode)) map.set(rec.commandCode, rec.status); // history is newest-first
    }
    return map;
  }, [history.data]);

  const stepLabel = (id: StepId) =>
    id === 'device'
      ? t('video.wizard.stepDevice')
      : id === 'test'
        ? t('video.wizard.stepTest')
        : t(`video.wizard.cat.${id}`, { defaultValue: CATEGORY_FALLBACK[id] ?? id });

  const commands = step !== 'device' && step !== 'test' ? (byCategory.get(step) ?? []) : [];

  function send(cmd: CommandDef, params: Record<string, string | number>): Promise<void> {
    return sendCommand.mutateAsync({ commandCode: cmd.code, params }).then(() => undefined);
  }

  return (
    <Drawer open={open} onClose={onClose} title={t('video.wizard.title')} size="lg">
      <div className="flex min-h-0 flex-col gap-4 lg:flex-row">
        {/* ── Step rail ── */}
        <nav
          aria-label={t('video.wizard.steps')}
          className="fv-scroll flex shrink-0 gap-1 overflow-x-auto lg:w-52 lg:flex-col lg:overflow-y-auto lg:overflow-x-hidden"
        >
          <StepButton
            active={step === 'device'}
            done={Boolean(deviceId)}
            icon={<Radio size={14} aria-hidden />}
            label={t('video.wizard.stepDevice')}
            onClick={() => setStep('device')}
          />
          {categorySteps.map(([cat, cmds]) => (
            <StepButton
              key={cat}
              active={step === cat}
              icon={<Camera size={14} aria-hidden />}
              label={stepLabel(cat)}
              count={cmds.length}
              disabled={!deviceId}
              onClick={() => setStep(cat)}
            />
          ))}
          <StepButton
            active={step === 'test'}
            icon={<Video size={14} aria-hidden />}
            label={t('video.wizard.stepTest')}
            disabled={!deviceId}
            onClick={() => setStep('test')}
          />
        </nav>

        {/* ── Step body ── */}
        <div className="fv-scroll min-h-0 flex-1 overflow-y-auto pe-1">
          {/* Device selection */}
          {step === 'device' && (
            <section className="flex flex-col gap-3">
              <StepHeader label={t('video.wizard.stepDevice')} />
              <Select
                label={t('video.setup.device')}
                hint={t('video.setup.deviceHint')}
                value={deviceId}
                onChange={(e) => setDeviceId(e.target.value)}
              >
                <option value="">{t('video.setup.pickDevice')}</option>
                {(devices.data ?? []).map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.imei} · {d.model ?? d.protocol}
                  </option>
                ))}
              </Select>
              {device && (
                <p className="text-xs text-gray-500 dark:text-graydark-600">
                  {t('video.setup.deviceMeta', {
                    protocol: device.protocol,
                    status: device.status,
                  })}
                </p>
              )}
              <Alert variant="info">{t('video.wizard.deviceHelp')}</Alert>
              {deviceId && (
                <Button size="sm" onClick={() => setStep('network')}>
                  {t('video.wizard.startConfig')}
                </Button>
              )}
            </section>
          )}

          {/* A command category */}
          {step !== 'device' && step !== 'test' && (
            <section className="flex flex-col gap-3">
              <StepHeader label={stepLabel(step)} />
              {!deviceId && <Alert variant="warning">{t('video.wizard.pickFirst')}</Alert>}
              {deviceId && commands.length === 0 && (
                <p className="text-sm text-gray-500 dark:text-graydark-600">
                  {t('video.wizard.emptyCategory')}
                </p>
              )}
              {deviceId &&
                commands.map((cmd) => (
                  <article
                    key={cmd.code}
                    className="rounded-xl border border-gray-200 p-3 dark:border-white/10"
                  >
                    <header className="mb-2 flex flex-wrap items-center gap-2">
                      <span className="rounded-md bg-brand-500/10 px-1.5 py-0.5 font-mono text-xs font-bold text-brand-600 dark:text-brand-300">
                        {cmd.code}
                      </span>
                      <h4 className="text-sm font-semibold text-gray-800 dark:text-graydark-800">
                        {fa ? cmd.nameFa : cmd.name}
                      </h4>
                      <StatusChip status={latestByCode.get(cmd.code)} />
                    </header>
                    <p className="mb-3 text-xs text-gray-500 dark:text-graydark-600">
                      {fa ? cmd.descriptionFa : cmd.description}
                    </p>
                    <CommandParamForm command={cmd} onSend={(params) => send(cmd, params)} />
                  </article>
                ))}
            </section>
          )}

          {/* Live test */}
          {step === 'test' && (
            <section className="flex flex-col gap-4">
              <StepHeader label={t('video.wizard.stepTest')} />

              <div className="rounded-xl border border-gray-200 p-3 dark:border-white/10">
                <h4 className="mb-2 text-sm font-semibold text-gray-800 dark:text-graydark-800">
                  {t('video.setup.stepChannel')}
                </h4>
                <div className="mb-2 grid grid-cols-3 gap-2">
                  <div className="col-span-2">
                    <Input
                      label={t('video.setup.channelLabel')}
                      value={channelLabel}
                      onChange={(e) => setChannelLabel(e.target.value)}
                      placeholder={t('video.setup.channelLabelPlaceholder')}
                    />
                  </div>
                  <Select
                    label={t('video.setup.channelNo')}
                    value={channelNo}
                    onChange={(e) => setChannelNo(e.target.value)}
                  >
                    {['1', '2', '3', '4'].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() =>
                      deviceId &&
                      device &&
                      registerChannel.mutate({
                        deviceId,
                        vehicleId: device.vehicleId,
                        label: channelLabel || `${device.model ?? 'MDVR'} · CH${channelNo}`,
                        logicalChannel: Number(channelNo),
                        imei: device.imei,
                      })
                    }
                    disabled={!deviceId || registerChannel.isPending}
                    loading={registerChannel.isPending}
                  >
                    {t('video.setup.registerChannel')}
                  </Button>
                  {registerChannel.isSuccess && (
                    <Badge color="success">
                      <CheckCircle2 size={12} aria-hidden />
                      {t('video.setup.registered')}
                    </Badge>
                  )}
                  {registerChannel.isError && (
                    <Badge color="danger">{registerChannel.error.message}</Badge>
                  )}
                </div>
              </div>

              <div className="rounded-xl border border-gray-200 p-3 dark:border-white/10">
                <h4 className="mb-2 text-sm font-semibold text-gray-800 dark:text-graydark-800">
                  {t('video.setup.stepTest')}
                </h4>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="success"
                    onClick={() =>
                      deviceId &&
                      startStream.mutate({ deviceId, logicalChannel: Number(channelNo) })
                    }
                    disabled={!deviceId || startStream.isPending}
                    loading={startStream.isPending}
                  >
                    {t('video.setup.startStream')}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      deviceId && stopStream.mutate({ deviceId, logicalChannel: Number(channelNo) })
                    }
                    disabled={!deviceId || stopStream.isPending}
                  >
                    {t('video.setup.stopStream')}
                  </Button>
                  {startStream.isSuccess && <StatusChip status="SENT" />}
                </div>
                <p className="mt-2 text-xs text-gray-500 dark:text-graydark-600">
                  {t('video.setup.testHelp')}
                </p>
              </div>

              {/* SMS cheat-sheet (bring-up before TCP works) */}
              <div className="rounded-xl border border-gray-200 dark:border-white/10">
                <button
                  type="button"
                  onClick={() => setShowHelp((s) => !s)}
                  className="flex w-full items-center gap-2 border-none bg-transparent px-3 py-2 text-sm font-semibold text-gray-700 cursor-pointer dark:text-graydark-700"
                >
                  <HelpCircle size={14} aria-hidden />
                  {t('video.setup.helpTitle')}
                </button>
                {showHelp && (
                  <div className="flex flex-col gap-2 border-t border-gray-200 px-3 py-3 text-xs leading-6 text-gray-600 dark:border-white/10 dark:text-graydark-600">
                    <Alert variant="warning">
                      <AlertTriangle size={14} aria-hidden className="shrink-0" />
                      {t('video.setup.helpCodec')}
                    </Alert>
                    <div>
                      <p className="mb-1 font-semibold text-gray-800 dark:text-graydark-800">
                        {t('video.setup.helpSmsTitle')}
                      </p>
                      <pre className="overflow-x-auto rounded-md bg-gray-100 p-2 text-left font-mono text-[11px] text-gray-700 dark:bg-white/5 dark:text-graydark-700">
                        {t('video.setup.helpSmsCommands')}
                      </pre>
                    </div>
                    <div>
                      <p className="mb-1 font-semibold text-gray-800 dark:text-graydark-800">
                        {t('video.setup.helpPortsTitle')}
                      </p>
                      <p>{t('video.setup.helpPorts')}</p>
                    </div>
                  </div>
                )}
              </div>
            </section>
          )}
        </div>
      </div>
    </Drawer>
  );
}

/** Catalog category display order (wizard rail). */
const CATEGORY_ORDER: readonly CommandCategory[] = [
  'network',
  'tracking',
  'media',
  'alerts',
  'geofence',
  'device',
  'outputs',
  'phone',
  'rfid',
  'temperature',
  'fuel',
  'tpms',
  'system',
  'custom',
];

/** English fallbacks if a category i18n key is missing. */
const CATEGORY_FALLBACK: Partial<Record<CommandCategory, string>> = {
  tracking: 'Tracking',
  network: 'Network',
  phone: 'Phone',
  alerts: 'Alerts',
  geofence: 'Geofence',
  device: 'Device',
  outputs: 'Outputs',
  rfid: 'RFID',
  temperature: 'Temperature',
  fuel: 'Fuel',
  tpms: 'TPMS',
  media: 'Media',
  system: 'System',
  custom: 'Custom',
};

/** One rail entry. */
function StepButton({
  active,
  done,
  icon,
  label,
  count,
  disabled,
  onClick,
}: {
  active: boolean;
  done?: boolean;
  icon: React.ReactNode;
  label: string;
  count?: number;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-start text-sm font-medium transition-colors cursor-pointer border-none disabled:cursor-not-allowed disabled:opacity-40 ${
        active
          ? 'bg-brand-500/10 text-brand-700 dark:text-brand-300'
          : 'bg-transparent text-gray-600 hover:bg-gray-100 dark:text-graydark-700 dark:hover:bg-white/5'
      }`}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count !== undefined && (
        <span className="inline-flex h-4 items-center rounded-full bg-gray-100 px-1.5 text-[0.6rem] font-semibold text-gray-500 dark:bg-white/10 dark:text-graydark-600">
          {count}
        </span>
      )}
      {done && <CheckCircle2 size={13} className="text-success-600" aria-hidden />}
    </button>
  );
}

/** Section heading inside a step body. */
function StepHeader({ label }: { label: string }) {
  return <h3 className="text-sm font-bold text-gray-800 dark:text-graydark-800">{label}</h3>;
}

/** Command lifecycle chip: QUEUED → SENT → ACKED/FAILED/EXPIRED. */
function StatusChip({ status }: { status?: CommandStatus }) {
  const { t } = useTranslation();
  if (!status) return null;
  const color =
    status === 'ACKED'
      ? 'success'
      : status === 'FAILED' || status === 'EXPIRED'
        ? 'danger'
        : 'warning';
  return (
    <Badge color={color}>{t(`video.setup.cmdStatus.${status}`, { defaultValue: status })}</Badge>
  );
}
