/**
 * CommandParamDialog — dynamic parameter form for one catalog command.
 *
 * Fields are rendered from the command's `params` defs (number / string /
 * enum), bilingual labels straight from the catalog (label/labelFa selected by
 * the active i18n locale — command terminology stays with the catalog, page
 * chrome stays in the locale files). Client-side checks mirror the catalog
 * rules (required / min / max / integer / maxLength); the backend re-validates
 * authoritatively (validateParams) and its message is surfaced on 422.
 */
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useToast } from '@/components/feedback/ToastProvider';
import { Alert, Button, Input, Modal, Select, Textarea } from '@/components/tailwind-ui';
import type { CommandDef, CommandParamDef } from '@/types/command.types';

interface CommandParamDialogProps {
  /** The command being configured (null = closed). */
  command: CommandDef | null;
  /** How many devices will receive this command (changes copy + toast). */
  deviceCount?: number;
  /** Submit — receives the typed param map. */
  onSubmit: (params: Record<string, string | number>) => Promise<void>;
  onClose: () => void;
}

type Values = Record<string, string>;

export function CommandParamDialog({
  command,
  deviceCount = 1,
  onSubmit,
  onClose,
}: CommandParamDialogProps) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const fa = i18n.language?.startsWith('fa');
  const [values, setValues] = useState<Values>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Reset per command; prefill defaults.
  useEffect(() => {
    if (!command) return;
    const initial: Values = {};
    for (const p of command.params) {
      initial[p.key] = p.defaultValue !== undefined ? String(p.defaultValue) : '';
    }
    setValues(initial);
    setErrors({});
    setServerError(null);
  }, [command]);

  const label = (p: CommandParamDef) => (fa ? p.labelFa : p.label) + (p.required ? ' *' : '');
  const hint = (p: CommandParamDef) => (fa ? p.hintFa : p.hint) ?? undefined;

  const set = (key: string, v: string) => {
    setValues((prev) => ({ ...prev, [key]: v }));
    setErrors((prev) => ({ ...prev, [key]: '' }));
  };

  const validate = (): Record<string, string | number> | null => {
    if (!command) return null;
    const out: Record<string, string | number> = {};
    const errs: Record<string, string> = {};
    for (const p of command.params) {
      const raw = (values[p.key] ?? '').trim();
      if (raw === '') {
        if (p.required) errs[p.key] = t('commands.form.required', { defaultValue: 'Required' });
        continue;
      }
      if (p.type === 'number') {
        const n = Number(raw);
        if (!Number.isFinite(n)) {
          errs[p.key] = t('commands.form.number', { defaultValue: 'Must be a number' });
          continue;
        }
        if (p.integer !== false && !Number.isInteger(n)) {
          errs[p.key] = t('commands.form.integer', { defaultValue: 'Must be an integer' });
          continue;
        }
        if (p.min !== undefined && n < p.min) {
          errs[p.key] = t('commands.form.min', { defaultValue: 'Min: {{min}}', min: p.min });
          continue;
        }
        if (p.max !== undefined && n > p.max) {
          errs[p.key] = t('commands.form.max', { defaultValue: 'Max: {{max}}', max: p.max });
          continue;
        }
        out[p.key] = n;
      } else {
        if (p.maxLength !== undefined && raw.length > p.maxLength) {
          errs[p.key] = t('commands.form.maxLength', {
            defaultValue: 'Max {{n}} characters',
            n: p.maxLength,
          });
          continue;
        }
        out[p.key] = raw;
      }
    }
    setErrors(errs);
    return Object.keys(errs).length > 0 ? null : out;
  };

  const handleRead = async () => {
    if (!command) return;
    setSubmitting(true);
    setServerError(null);
    try {
      await onSubmit({});
      toast.success(
        t('commands.form.readQueued', {
          defaultValue: 'Reading current settings from the device…',
          code: command.readbackCommand ?? command.code,
        }),
      );
    } catch (err) {
      setServerError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = async () => {
    if (!command) return;
    const params = validate();
    if (!params) return;
    setSubmitting(true);
    setServerError(null);
    try {
      await onSubmit(params);
      toast.success(
        deviceCount > 1
          ? t('commands.sentBulk', {
              defaultValue: 'Command {{code}} queued on {{count}} devices',
              code: command.code,
              count: deviceCount,
            })
          : t('commands.sent', {
              defaultValue: 'Command {{code}} queued',
              code: command.code,
            }),
      );
      onClose();
    } catch (err) {
      setServerError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const hasParams = useMemo(() => (command?.params.length ?? 0) > 0, [command]);

  return (
    <Modal
      open={Boolean(command)}
      onClose={onClose}
      size="lg"
      title={
        command ? (
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono font-bold text-brand-600 dark:text-brand-400">
              {command.code}
            </span>
            <span>{fa ? command.nameFa : command.name}</span>
          </span>
        ) : undefined
      }
      footer={
        command ? (
          <>
            <Button variant="outline" onClick={onClose} disabled={submitting}>
              {t('common.cancel', { defaultValue: 'Cancel' })}
            </Button>
            {command.supportsReadback && (
              <Button variant="outline" onClick={() => void handleRead()} loading={submitting}>
                {t('commands.form.read', { defaultValue: 'Read current' })}
              </Button>
            )}
            <Button onClick={() => void handleSubmit()} loading={submitting}>
              {deviceCount > 1
                ? t('commands.form.sendBulk', {
                    defaultValue: 'Send to {{count}} devices',
                    count: deviceCount,
                  })
                : t('commands.form.send', { defaultValue: 'Send command' })}
            </Button>
          </>
        ) : undefined
      }
    >
      {command && (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-gray-500 dark:text-graydark-600">
            {fa ? command.descriptionFa : command.description}
          </p>
          {deviceCount > 1 && (
            <Alert variant="info">
              {t('commands.form.bulkHint', {
                defaultValue: 'The same values will be sent to {{count}} selected devices.',
                count: deviceCount,
              })}
            </Alert>
          )}
          {serverError && <Alert variant="danger">{serverError}</Alert>}
          {!hasParams && (
            <Alert variant="info">
              {t('commands.form.noParams', {
                defaultValue: 'This command takes no parameters — confirm to send.',
              })}
            </Alert>
          )}
          {command.params.map((p) => {
            const fieldLabel = `${label(p)}${p.unit ? ` (${p.unit})` : ''}`;
            const fieldError = errors[p.key] || null;
            // Mirrors the MUI helperText chain: error text → hint → spacer.
            const hintText = errors[p.key] ? null : (hint(p) ?? ' ');
            const isEnum = p.type === 'enum' && (p.options?.length ?? 0) > 0;
            const multiline = p.type === 'string' && (p.maxLength ?? 0) > 60;

            if (isEnum) {
              return (
                <Select
                  key={p.key}
                  label={fieldLabel}
                  value={values[p.key] ?? ''}
                  onChange={(e) => set(p.key, e.target.value)}
                  error={fieldError}
                  hint={hintText}
                  options={(p.options ?? []).map((o) => ({
                    value: o.value,
                    label: (
                      <>
                        {fa ? o.labelFa : o.label}{' '}
                        <span className="text-xs text-gray-500 dark:text-graydark-600">
                          ({o.value})
                        </span>
                      </>
                    ),
                  }))}
                />
              );
            }
            if (multiline) {
              return (
                <Textarea
                  key={p.key}
                  label={fieldLabel}
                  rows={2}
                  value={values[p.key] ?? ''}
                  onChange={(e) => set(p.key, e.target.value)}
                  error={fieldError}
                  hint={hintText}
                  maxLength={p.maxLength}
                />
              );
            }
            return (
              <Input
                key={p.key}
                label={fieldLabel}
                value={values[p.key] ?? ''}
                onChange={(e) => set(p.key, e.target.value)}
                error={fieldError}
                hint={hintText}
                inputMode={p.type === 'number' ? 'decimal' : undefined}
                maxLength={p.maxLength}
              />
            );
          })}
        </div>
      )}
    </Modal>
  );
}
