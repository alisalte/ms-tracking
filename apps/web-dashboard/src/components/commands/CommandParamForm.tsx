/**
 * CommandParamForm — the dynamic parameter form for one catalog command
 * (shared by the Command Center dialog and the Device Config Wizard).
 *
 * Fields are rendered from the command's `params` defs (number / string /
 * enum), bilingual labels straight from the catalog (label/labelFa selected by
 * the active i18n locale). Client-side checks mirror the catalog rules
 * (required / min / max / integer / maxLength); the backend re-validates
 * authoritatively (validateParams) and its message is surfaced on 422.
 */
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button, Input, Select, Textarea } from '@/components/tailwind-ui';
import { parseMeitrackReadback } from '@/lib/meitrack-readback';
import type { CommandDef, CommandParamDef } from '@/types/command.types';

interface CommandParamFormProps {
  /** The command whose fields are rendered. */
  command: CommandDef;
  /** Submit — receives the typed param map. Optional code override is used on Read (DB4). */
  onSend: (params: Record<string, string | number>, commandCode?: string) => Promise<void>;
  /** Disable the send button (e.g. no device selected / already submitting). */
  disabled?: boolean;
  /** Override the send label (defaults to the shared "Send command"). */
  sendLabel?: string;
  /** Latest ACK body for this command — shown as raw text. */
  lastAckText?: string | null;
  /** Parsed settings to prefill the form (DB4 dump or last SET params). */
  prefill?: Record<string, string> | null;
}

type Values = Record<string, string>;

export function CommandParamForm({
  command,
  onSend,
  disabled = false,
  sendLabel,
  lastAckText,
  prefill,
}: CommandParamFormProps) {
  const { t, i18n } = useTranslation();
  const fa = i18n.language?.startsWith('fa');
  const [values, setValues] = useState<Values>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const prefillSig = prefill ? JSON.stringify(prefill) : '';

  // Reset per command; overlay last known device/SET values when they change.
  useEffect(() => {
    const parsed = prefillSig ? (JSON.parse(prefillSig) as Record<string, string>) : null;
    const initial: Values = {};
    for (const p of command.params) {
      initial[p.key] = p.defaultValue !== undefined ? String(p.defaultValue) : '';
    }
    if (parsed) {
      for (const p of command.params) {
        if (parsed[p.key] !== undefined) initial[p.key] = parsed[p.key] ?? '';
      }
    }
    setValues(initial);
    setErrors({});
    setServerError(null);
  }, [command, prefillSig]);

  useEffect(() => {
    if (!lastAckText) return;
    const parsed = parseMeitrackReadback(command.code, lastAckText);
    if (!parsed || Object.keys(parsed).length === 0) return;
    setValues((prev) => {
      const next = { ...prev };
      for (const p of command.params) {
        if (parsed[p.key] !== undefined) next[p.key] = parsed[p.key] ?? '';
      }
      return next;
    });
  }, [command, lastAckText]);

  const label = (p: CommandParamDef) => (fa ? p.labelFa : p.label) + (p.required ? ' *' : '');
  const hint = (p: CommandParamDef) => (fa ? p.hintFa : p.hint) ?? undefined;

  const set = (key: string, v: string) => {
    setValues((prev) => ({ ...prev, [key]: v }));
    setErrors((prev) => ({ ...prev, [key]: '' }));
  };

  const validate = (): Record<string, string | number> | null => {
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
    setSubmitting(true);
    setServerError(null);
    try {
      // A11/A21 only ACK OK — send DB4 (or the catalog readbackCommand) instead.
      await onSend({}, command.readbackCommand ?? command.code);
    } catch (err) {
      setServerError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = async () => {
    const params = validate();
    if (!params) return;
    setSubmitting(true);
    setServerError(null);
    try {
      await onSend(params);
    } catch (err) {
      setServerError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {command.params.map((p) => {
        const fieldLabel = `${label(p)}${p.unit ? ` (${p.unit})` : ''}`;
        const fieldError = errors[p.key] || null;
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
      {serverError && <p className="text-xs text-danger-600">{serverError}</p>}
      {lastAckText ? (
        <p
          className="break-all font-mono text-xs text-gray-500 dark:text-graydark-600"
          data-testid="command-last-ack"
        >
          {lastAckText}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {command.supportsReadback && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => void handleRead()}
            disabled={disabled}
            loading={submitting}
            data-testid="command-read"
          >
            {t('commands.form.read', { defaultValue: 'Read current' })}
          </Button>
        )}
        <Button
          size="sm"
          onClick={() => void handleSubmit()}
          disabled={disabled}
          loading={submitting}
        >
          {sendLabel ?? t('commands.form.send', { defaultValue: 'Send command' })}
        </Button>
      </div>
    </div>
  );
}
